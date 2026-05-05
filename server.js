
const { spawn } = require('child_process');
const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Limits ───────────────────────────────────────────────────────────────────

const STANDARD_TIMEOUT         = 120_000;       // ms — kill hung processes
const STANDARD_MAX_OUTPUT      = 1_000_000;     // bytes — max stdout+stderr
const USER_FOLDER_TTL_MS       = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS      =      30 * 60 * 1000;
const MAX_FILES_PER_USER       = 20;
const MAX_TOTAL_BYTES_PER_USER = 20 * 1024 * 1024; // 20 MB

// ─── Rate Limiters ────────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

const runLimiter = rateLimit({
    windowMs:        RATE_LIMIT_WINDOW_MS,
    max:             10,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { error: 'Too many requests, please wait before running another job.' }
});

const uploadLimiter = rateLimit({
    windowMs:        RATE_LIMIT_WINDOW_MS,
    max:             20,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         'Upload limit reached, please wait.'
});

// ─── Tool Registry ────────────────────────────────────────────────────────────
/*
  Loaded automatically at startup by scanning tools/<toolSlug>/config.json.

  Each config.json must contain:
    name           — executable name used in API calls and the UI
    displayName    — human-readable title shown in the page header
    description    — short blurb for the landing page card
    absPath        — absolute path to the executable on this server
    allowedFileTypes — array of extensions e.g. [".txt",".fa"], or null for unrestricted
    parameters     — object mapping param label → CLI template  e.g. { "Organism": "-d <>" }

  The slug (folder name under tools/) becomes the URL path, e.g.
    tools/cpb_max_tool  →  compbio.hpc.edu/cpb_max_tool
*/
const TOOLS_DIR = path.join(__dirname, 'tools');

// toolRegistry: Map<slug, { config, htmlPath }>
const toolRegistry = new Map();

function loadToolRegistry() {
    if (!fs.existsSync(TOOLS_DIR)) {
        console.warn('[tools] tools/ directory not found — no tools loaded');
        return;
    }

    for (const slug of fs.readdirSync(TOOLS_DIR)) {
        const toolDir    = path.join(TOOLS_DIR, slug);
        const configPath = path.join(toolDir, 'config.json');
        const htmlPath   = path.join(toolDir, 'index.html');

        if (!fs.statSync(toolDir).isDirectory()) continue;

        if (!fs.existsSync(configPath)) {
            console.warn(`[tools] Skipping ${slug}: missing config.json`);
            continue;
        }
        if (!fs.existsSync(htmlPath)) {
            console.warn(`[tools] Skipping ${slug}: missing index.html`);
            continue;
        }

        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const required = ['name', 'displayName', 'absPath', 'parameters'];
            const missing  = required.filter(k => !(k in config));
            if (missing.length) {
                console.warn(`[tools] Skipping ${slug}: config missing fields: ${missing.join(', ')}`);
                continue;
            }
            toolRegistry.set(slug, { config, htmlPath });
            console.log(`[tools] Loaded tool: /${slug}  (${config.name})`);
        } catch (err) {
            console.warn(`[tools] Skipping ${slug}: failed to parse config.json — ${err.message}`);
        }
    }
}

loadToolRegistry();

// ─── Upload folder ────────────────────────────────────────────────────────────
const uploadFolder = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);
app.get('/uploads/:userId/:filename', (req, res) => {
    const { userId, filename } = req.params;

    // Validate userId format
    if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
        return res.status(400).send('Invalid userId');
    }

    // Resolve and verify the path stays within the user's folder
    const userFolder = path.resolve(path.join(uploadFolder, userId));
    const filePath   = path.resolve(path.join(userFolder, filename));

    if (!filePath.startsWith(userFolder + path.sep)) {
        return res.status(403).send('Forbidden');
    }

    // Only serve if the requesting session owns this folder
    const requestingUser = req.query.userId || req.headers['x-user-id'];
    if (requestingUser !== userId) {
        return res.status(403).send('Forbidden');
    }

    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    res.sendFile(filePath);
});

// ─── TTL Cleanup ──────────────────────────────────────────────────────────────
function cleanupStaleFolders() {
    let removed = 0;
    try {
        const entries = fs.readdirSync(uploadFolder, { withFileTypes: true });
        const now = Date.now();
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const folderPath = path.join(uploadFolder, entry.name);
            let latestMtime  = fs.statSync(folderPath).mtimeMs;
            try {
                for (const file of fs.readdirSync(folderPath)) {
                    const s = fs.statSync(path.join(folderPath, file));
                    if (s.mtimeMs > latestMtime) latestMtime = s.mtimeMs;
                }
            } catch { /* skip */ }
            if (now - latestMtime > USER_FOLDER_TTL_MS) {
                fs.rmSync(folderPath, { recursive: true, force: true });
                removed++;
            }
        }
    } catch (err) {
        console.error('[cleanup] Error:', err.message);
    }
    if (removed > 0) console.log(`[cleanup] Removed ${removed} stale user folder(s).`);
}
cleanupStaleFolders();
setInterval(cleanupStaleFolders, CLEANUP_INTERVAL_MS);

// ─── Per-user Quota ───────────────────────────────────────────────────────────
function checkUserQuota(userFolder) {
    let fileCount = 0, totalBytes = 0;
    try {
        for (const file of fs.readdirSync(userFolder)) {
            const stat = fs.statSync(path.join(userFolder, file));
            if (stat.isFile()) { fileCount++; totalBytes += stat.size; }
        }
    } catch { /* folder may not exist */ }
    return {
        exceeded: fileCount >= MAX_FILES_PER_USER || totalBytes >= MAX_TOTAL_BYTES_PER_USER,
        fileCount,
        totalBytes
    };
}

// ─── Multer ───────────────────────────────────────────────────────────────────
// Collect every allowed extension across all loaded tools
function getAllowedUploadTypes() {
    const exts = new Set();
    for (const { config } of toolRegistry.values()) {
        if (Array.isArray(config.allowedFileTypes)) {
            config.allowedFileTypes.forEach(e => exts.add(e.toLowerCase()));
        }
    }
    return [...exts];
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const userId = req.query.userId || req.body.userId;
        if (!userId) return cb(new Error('Missing userId'));
        const userFolder = path.join(uploadFolder, userId);
        if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });
        cb(null, userFolder);
    },
    filename(req, file, cb) { cb(null, file.originalname); }
});

const upload = multer({
    storage,
    fileFilter(req, file, cb) {
        const ext     = path.extname(file.originalname).toLowerCase();
        const allowed = getAllowedUploadTypes();
        allowed.includes(ext)
            ? cb(null, true)
            : cb(new Error('File type not accepted: ' + ext));
    },
    limits: { fileSize: 2 * 1024 * 1024 }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveStdinData(stdin) {
    if (!stdin) return { data: null, error: null };

    if (stdin.type === 'file') {
        if (!stdin.userId || !stdin.filename)
            return { data: null, error: { status: 400, message: 'Missing userId or filename for stdin file' } };
        const filePath   = path.resolve(path.join(uploadFolder, stdin.userId, stdin.filename));
        const allowedDir = path.resolve(path.join(uploadFolder, stdin.userId));
        if (!filePath.startsWith(allowedDir + path.sep))
            return { data: null, error: { status: 403, message: 'Invalid file path' } };
        if (!fs.existsSync(filePath))
            return { data: null, error: { status: 404, message: 'File not found' } };
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            if (data.length > STANDARD_MAX_OUTPUT)
                return { data: null, error: { status: 400, message: 'Stdin data exceeds maximum size' } };
            return { data, error: null };
        } catch {
            return { data: null, error: { status: 500, message: 'Failed to read stdin file' } };
        }
    }

    if (stdin.type === 'direct') {
        if (typeof stdin.data !== 'string')
            return { data: null, error: { status: 400, message: 'Invalid stdin data' } };
        if (stdin.data.length > STANDARD_MAX_OUTPUT)
            return { data: null, error: { status: 400, message: 'Stdin data exceeds maximum size' } };
        return { data: stdin.data, error: null };
    }

    return { data: null, error: null };
}

function buildFinalArgs(paramTemplates, args) {
    const finalArgs = [];
    for (const [paramName, userValue] of Object.entries(args)) {
        const template = paramTemplates[paramName];
        if (!template)                     return { args: null, error: { status: 400, message: `Invalid parameter: ${paramName}` } };
        if (typeof userValue !== 'string') return { args: null, error: { status: 400, message: `Invalid value for ${paramName}` } };
        if (userValue.length > 200)        return { args: null, error: { status: 400, message: `Value too long for ${paramName}` } };
        if (!template.includes('<>')) {
            if (userValue === 'true') finalArgs.push(template);
        } else {
            finalArgs.push(template.replace('<>', userValue));
        }
    }
    return { args: finalArgs, error: null };
}

function validateFileTypesForCommand(allowedTypes, args, stdin) {
    if (!allowedTypes) return { error: null };

    function checkExt(filename, context) {
        const ext = path.extname(filename).toLowerCase();
        if (!allowedTypes.includes(ext))
            return { error: { status: 400, message: `File type ${ext} not allowed for ${context}` } };
        return { error: null };
    }

    for (const [paramName, value] of Object.entries(args)) {
        if (typeof value === 'string' && value.startsWith('uploads/')) {
            const result = checkExt(path.basename(value), `param "${paramName}"`);
            if (result.error) return result;
        }
    }

    if (stdin?.type === 'file' && stdin.filename) {
        const result = checkExt(stdin.filename, 'stdin');
        if (result.error) return result;
    }

    return { error: null };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Landing page  GET /
app.get('/', (req, res) => {
    const landingPath = path.join(__dirname, 'landing', 'index.html');
    if (fs.existsSync(landingPath)) {
        return res.sendFile(landingPath);
    }
    // Auto-generated fallback if landing/index.html doesn't exist yet
    const cards = [...toolRegistry.entries()].map(([slug, { config }]) => `
        <div class="card">
            <h2><a href="/${slug}">${config.displayName}</a></h2>
            <p>${config.description || ''}</p>
        </div>`).join('');
    res.send(`<!DOCTYPE html><html><head>
        <title>CompBio HPC Tools</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
            body { font-family: system-ui, sans-serif; max-width: 760px; margin: 60px auto; padding: 0 16px; }
            h1 { margin-bottom: 32px; }
            .card { border: 1px solid #ddd; border-radius: 8px; padding: 20px 24px; margin-bottom: 16px; }
            .card h2 a { text-decoration: none; color: #2563eb; }
            .card p { color: #555; margin-top: 6px; font-size: 14px; }
        </style>
    </head><body>
        <h1>CompBio HPC Tools</h1>
        ${cards || '<p>No tools configured yet.</p>'}
    </body></html>`);
});

// POST /run — accepts { toolSlug, command, args, stdin }
//   toolSlug is optional; if omitted the command name is matched across all tools
// POST /run — accepts { toolSlug, command, args, stdin }
//   toolSlug is optional; if omitted the command name is matched across all tools
app.post('/run',    runLimiter,    (req, res) => {
    const { toolSlug, command, args, stdin } = req.body;

    if (!command)                          return res.status(400).json({ error: 'Missing command' });
    if (!args || typeof args !== 'object') return res.status(400).json({ error: 'Args must be an object' });

    // Find the matching tool entry
    let matchedConfig = null;
    if (toolSlug) {
        const tool = toolRegistry.get(toolSlug);
        if (tool && tool.config.name === command) matchedConfig = tool.config;
    } else {
        // fallback: search by command name
        for (const { config } of toolRegistry.values()) {
            if (config.name === command) { matchedConfig = config; break; }
        }
    }

    if (!matchedConfig) return res.status(403).json({ error: 'Command not allowed' });

    const { args: finalArgs, error: argsError } = buildFinalArgs(matchedConfig.parameters, args);
    if (argsError) return res.status(argsError.status).json({ error: argsError.message });

    const { data: stdinData, error: stdinError } = resolveStdinData(stdin);
    if (stdinError) return res.status(stdinError.status).json({ error: stdinError.message });

    const { error: fileTypeError } = validateFileTypesForCommand(
        matchedConfig.allowedFileTypes, args, stdin
    );
    if (fileTypeError) return res.status(fileTypeError.status).json({ error: fileTypeError.message });

    const child = spawn(matchedConfig.absPath, finalArgs, {
        stdio: [stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        shell: false
    });

    let stdout = '', stderr = '';

    // flags and helper to ensure we only send one response back to the client, even if multiple events/errors occur
    let responded = false;
    let killReason = null; 

    function sendOnce(statusCode, body) {
        if (responded) return;
        responded = true;
        clearTimeout(timeout);
        res.status(statusCode).json(body);
    }

    const timeout = setTimeout(() => {
        killReason = 'timeout';
        child.kill('SIGKILL');
    }, STANDARD_TIMEOUT);

    if (stdinData) { child.stdin.write(stdinData); child.stdin.end(); }

    child.stdout.on('data', data => {
        stdout += data.toString();
        if (stdout.length > STANDARD_MAX_OUTPUT) {
            killReason = 'output_limit';
            child.kill('SIGKILL');
        }
    });
    child.stderr.on('data', data => { stderr += data.toString(); });

    child.on('close', code => {
        if (killReason === 'timeout') {
            sendOnce(504, { error: 'Process timed out', stdout, stderr });
        } else if (killReason === 'output_limit') {
            sendOnce(413, { error: 'Output size limit exceeded', stdout, stderr });
        } else {
            sendOnce(200, { success: code === 0, exitCode: code, stdout, stderr });
        }
    });
    child.on('error', (err) => {
        console.error('[run] Child process error:', err.message);
        sendOnce(500, { error: 'Execution error' });
    });
});

// POST /upload
app.post('/upload', uploadLimiter, (req, res, next) => {
    const userId = req.query.userId || req.body.userId;
    if (userId) {
        const userFolder = path.join(uploadFolder, userId);
        const quota = checkUserQuota(userFolder);
        if (quota.exceeded) {
            return res.status(429).send(
                `Upload limit reached (max ${MAX_FILES_PER_USER} files / ${MAX_TOTAL_BYTES_PER_USER / 1024 / 1024} MB per session).`
            );
        }
    }
    next();
}, upload.single('file'), (req, res) => {
    res.send('File uploaded successfully!');
});

// GET /tools — JSON list of available tools (used by landing page or toolbars)
app.get('/tools', (req, res) => {
    const list = [...toolRegistry.entries()].map(([slug, { config }]) => ({
        slug,
        name:        config.name,
        displayName: config.displayName,
        description: config.description || ''
    }));
    res.json(list);
});

// GET /files
app.get('/files', (req, res) => {
    const userId = req.query.userId || req.body.userId;
    if (!userId) return res.status(400).send('Missing userId');
    const userFolder = path.join(uploadFolder, userId);
    if (!fs.existsSync(userFolder)) return res.json([]);
    fs.readdir(userFolder, (err, files) => {
        if (err) { console.error(err); return res.status(500).send('Error reading files'); }
        res.json(files);
    });
});

// GET /files-with-mtimes
app.get('/files-with-mtimes', (req, res) => {
    const userId = req.query.userId || req.body.userId;
    if (!userId) return res.status(400).send('Missing userId');
    const userFolder = path.join(uploadFolder, userId);
    if (!fs.existsSync(userFolder)) return res.json([]);
    fs.readdir(userFolder, (err, files) => {
        if (err) { console.error(err); return res.status(500).send('Error reading files'); }
        try {
            res.json(files.map(file => {
                const stat = fs.statSync(path.join(userFolder, file));
                return { name: file, mtime: stat.mtimeMs };
            }));
        } catch { res.status(500).send('Error reading file stats'); }
    });
});

// GET /default-files
app.get('/default-files', (req, res) => {
    const userId = req.query.userId;
    if (!userId)                         return res.status(400).json({ error: 'Missing userId' });
    if (!/^[a-zA-Z0-9_-]+$/.test(userId)) return res.status(400).json({ error: 'Invalid userId' });

    // Each tool config may carry a defaultFiles array: [{ dir, filename }, ...]
    const defaultFiles = [];
    for (const { config } of toolRegistry.values()) {
        if (Array.isArray(config.defaultFiles)) defaultFiles.push(...config.defaultFiles);
    }

    const userFolder = path.resolve(path.join(uploadFolder, userId));
    if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });

    const copied = [], errors = [];
    for (const { dir, filename } of defaultFiles) {
        if (!dir || !filename) continue;
        const srcPath      = path.resolve(path.join(dir, filename));
        const allowedSrcDir = path.resolve(dir);
        if (!srcPath.startsWith(allowedSrcDir + path.sep) && srcPath !== allowedSrcDir) {
            errors.push({ filename, error: 'Path traversal rejected' }); continue;
        }
        const destPath = path.resolve(path.join(userFolder, filename));
        if (!destPath.startsWith(userFolder + path.sep)) {
            errors.push({ filename, error: 'Invalid destination' }); continue;
        }
        if (fs.existsSync(destPath)) { copied.push(filename); continue; }
        if (!fs.existsSync(srcPath)) {
            errors.push({ filename, error: 'Source file not found: ' + srcPath }); continue;
        }
        try { fs.copyFileSync(srcPath, destPath); copied.push(filename); }
        catch (err) { errors.push({ filename, error: err.message }); }
    }
    res.json({ copied, errors });
});

// Per-tool UI  GET /:slug
app.get('/:slug', (req, res) => {
    const tool = toolRegistry.get(req.params.slug);
    if (!tool) return res.status(404).send('Tool not found');
    res.sendFile(tool.htmlPath);
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
