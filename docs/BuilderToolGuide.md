![Builder Tool Guide](/docs/imgs/Builder-Tool-Guide.png)

Welcome to the builder tool guide follow this page to start building a web interface for your command line tool.

### Step 1
Fill out the command name at the top. The command name is also the name of the file you uploaded in step 3 "Upload Command Line Tool" in the ReadMe.md.

* EXAMPLE:
    * The file name of the command line tool is ***tool.py*** so you fill in the field ***tool.py***

### Step 2
Fill out the absolute path field. Enter the absolute path for the file you uploaded in step 3 "Upload Command Line Tool" in the ReadMe.md. 

**INCLUDE the file name in the path.**

* EXAMPLE:
    * The absolute path to ***tool.py*** is */user/example/bin/tool.py* fill in the field */user/example/bin/tool.py* 


### Step 3
If your command line tool uses standard input make sure to toggle on standard input. 

* Select text if your command line tool only uses text for standard input.
* Select file if your command line tool only uses files for standard input.
* Select text and file if your command line tool only uses both files or text for standard input.

Whenever a file type is a option for standard input you may define file restrictions. By default all files will be accepted. However, if you want to restrict the user to only be able to upload a specific type of file you may do so by clicking the button "Add File Restrictions"

### Step 4 
Add parameters. These can be either optional or required.
* optional parameters do NOT need to be filled in order to run the command
* required parameters do need to be filled in order to run the command

You can create one of the following parameters by clicking the plus button next to REQUIRED PARAMETER(for a required parameter) or OPTIONAL PARAMETER(for a optional parameter).

Clicking the plus button will open up the parameter form. This form will enable you to customize your parameter. Use this [Parameter Form](/docs/ParameterFormGuide.md) guide for assistance.

### Step 5
You may create more commands by clicking the plus button on the left sidebar near commands. Repeat steps 1-4 for this new command. However, if you would like to just handle 1 command for your interface you may move onto step 6. Make sure to also upload the additional command files to the directory as well.

### Step 6
Download index.html and config.json by clicking the download website button. You are almost there! Hold onto these files and return to step 5 in [readMe](/README.md) to continue.

