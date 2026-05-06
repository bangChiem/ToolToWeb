![Parameter Form Guide](/docs/imgs/Parameter-Form-Guide.png)


---
Welcome to the Parameter Form Guide. Use this form to customize your parameter to accomadate your parameter for your command line tool.

### Step 1: fill out Parameter name
Fill out the parameter name. This acts as the label used for the parameter on the web interface shown below:

![Parameter Name Form Image](/docs/imgs/parameter_form/Parameter-Name-P-Form.png)

### Step 2: fill out Parameter Type
Fill out the parameter type. This field allows you to choose the input type to handle four possible parameter types:

* Boolean: 
    * True or false values.
* String
    * For basic character input.
* File: 
    *   For file input. Enable users to upload files for your command to process. Once the execution is complete, the modified files are made available for the user to download.
* Number
    * For numerical values. You may limit between floats and integers with maximum and minimum values. 
* Muli-Select
    * For a set of options for example (red, green, blue). 

The image below shows how the UI will look like for the selected parameter type:

![Parameter Type Form Image](/docs/imgs/parameter_form/Parameter-Type-P-Form.png)

Depending on which type you select there are further customization options availble. These are listed below:

**Number**

*These fields are optional and my be left blank*
* Maximum
    * define what is the largest value the field will accept.
* Minimum
    * define what is the smallest value the field will accept.
* Integer Only
    * toggle this on to restrict the input to reject decimal values.

**Multi Value**

*This field MUST be completed*
* Use this field to create the options that users can choose from in the multi-select box.
 For example, if you want the user to choose between option1, option2, and option3. Enter in the box: 
    * option1, option2, option3

**File**

*This field is optional and may be left blank*

* You may define file restriction. By default all files will be accepted. However, if you want to restrict the user to only be able to upload a specific type of file you may do so by clicking the button "Add File Restrictions".


### Step 3: fill out Parameter Value
This field is used to handle parameters that require special syntax and ARE NOT boolean. The Parameter Value does not change anything on the front end of the webpage. However, it does effect how the command will be executed. What you type into this field will be the way the user input for a parameter is parsed and then given to the command. Take a look at the example below for further clarification:

![Paramter Type Form special syntax handling: type in <> to show where user input will be inserted](/docs/imgs/parameter_form/Parameter-Value-P-Form.png)

If your parameter type **IS** boolean this field will be what is given to the command when the user checks the box for the parameter. For example, if you enter ***-v*** in the field, when the user checks the box and executes the command the command will be run with ***-v*** as a flag. If the user does not check the box then no flag will be used when calling the command.

### Step 4: fill out Parameter Description
To help users use your web interface you can leave tool tips to describe what the parameter does. What you enter in the parameter description field will be the text displayed in the tool tip. The image below shows how this will look:
![When user highlights on ? tool tip icon, the description text will show up](/docs/imgs/parameter_form/Parameter-Description-P-Form.png)


### Step 5: fill out Default Value
Use the Default Value field to pre-fill a parameter with a value in the user interface. For example, if you have a numeric parameter that should start at 2.5, enter 2.5 in the field below. The parameter will automatically be set to this value unless the user changes it.

For files you can define default files. However, you will also need to define the absolute path to this default file.

### Step 6: Review Parameter
A summary will be created from all the configurations you gave. Confirm the parameter is correct and proceed to [step 5 in the builder tool guide](/docs/BuilderToolGuide.md).