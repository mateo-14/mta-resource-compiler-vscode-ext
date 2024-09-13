// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import path from 'path';
import * as vscode from 'vscode';
import fs, { openAsBlob } from 'fs';
import { XMLParser, } from 'fast-xml-parser';
import { Readable } from 'stream';

const MTA_RESOURCE_FOLDER = '/server/mods/deathmatch/resources';
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('MTA Resource Compiler');
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('mta-resource-compiler.compileResource', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		const activeTextEditor = vscode.window.activeTextEditor;
		if (!activeTextEditor) {
			vscode.window.showErrorMessage('You must have a file open to compile a resource.');
			return;
		}

		const currentFile = activeTextEditor.document.uri.fsPath;
		const currentDir = path.dirname(currentFile);
		const ignoreServerSideScripts = vscode.workspace.getConfiguration('mta-resource-compiler').get('ignoreServerSideScripts') as boolean;
		const outputPath = vscode.workspace.getConfiguration('mta-resource-compiler').get('outputPath') as string;
		if (!outputPath) {
			vscode.window.showErrorMessage('Output compiled resources path is not set.');
			return;
		}

		if (!currentDir.replaceAll('\\', '/').includes(MTA_RESOURCE_FOLDER)) {
			vscode.window.showErrorMessage('You must be in a resource root directory to compile a resource.');
			return;
		}

		let resourceRootDir = currentDir;
		while (!resourceRootDir.replaceAll('\\', '/').endsWith(MTA_RESOURCE_FOLDER)) {
			const exists = fs.existsSync(path.join(resourceRootDir, 'meta.xml'));
			if (!exists) {
				outputChannel.appendLine(`Not found 'meta.xml' file in ${resourceRootDir}`);
				resourceRootDir = path.dirname(resourceRootDir);
				continue;
			}

			const xmlData = fs.readFileSync(path.join(resourceRootDir, 'meta.xml'), 'utf8');
			const parser = new XMLParser({
				ignoreAttributes: false,

			});

			const parsedData = parser.parse(xmlData);
			if (parsedData.meta) {
				if (!parsedData.meta.script || parsedData.meta.script.length === 0) {
					vscode.window.showInformationMessage('Not found scripts in the resource root directory.');
					return;
				}

				const scripts = Array.isArray(parsedData.meta.script) ? parsedData.meta.script : [parsedData.meta.script];
				const filesToCompile: string[] = [];

				scripts.forEach((script: any) => {
					if (ignoreServerSideScripts && (!script['@_type'] || script['@_type'] === 'server')) {
						return;
					}

					const scriptPath = path.join(resourceRootDir, script['@_src']);
					if (fs.existsSync(scriptPath)) {
						filesToCompile.push(script['@_src']);
					}
				});


				if (filesToCompile.length === 0) {
					vscode.window.showInformationMessage('Not found scripts in the resource root directory.');
					return;
				}

				const resourceFolderName = path.basename(resourceRootDir);
				if (fs.existsSync(path.join(outputPath, resourceFolderName))) {
					outputChannel.appendLine(`Removing old compiled resource in ${resourceFolderName}`);
					fs.rmdirSync(path.join(outputPath, resourceFolderName), { recursive: true });
				}

				outputChannel.appendLine(`Creating new compiled resource in ${resourceFolderName}`);
				fs.mkdirSync(path.join(outputPath, resourceFolderName));
				// Copy all files to the output path
				fs.cpSync(resourceRootDir, path.join(outputPath, resourceFolderName), {
					recursive: true, filter(source) {
						return !filesToCompile.some(file => source.includes(path.join(resourceRootDir, file)));
					},
				});

				vscode.window.showInformationMessage(`Compiling resource ${resourceFolderName} (${resourceRootDir}).`);
				for (const file of filesToCompile) {
					const fileName = path.basename(file);

					outputChannel.appendLine(`Compiling ${fileName}`);
					const formdata = new FormData();
					formdata.append("compile", "1");
					formdata.append("debug", "0");
					formdata.append("obfuscate", "3");
					const fileBuffer = fs.readFileSync(path.join(resourceRootDir, file));
					formdata.append("luasource", new File([fileBuffer], fileName));

					const res = await fetch("http://luac.mtasa.com/index.php", {
						method: "POST",
						body: formdata
					});

					// Convert body to compiled lua
					if (!res.ok || res.body === null) {
						outputChannel.appendLine(`Error compiling ${fileName}`);
						return;
					}

					const compiledFile = path.join(outputPath, resourceFolderName, fileName);
					const writer = fs.createWriteStream(compiledFile);
					Readable.fromWeb(res.body).pipe(writer);
				}
	
				vscode.window.showInformationMessage(`Resource ${resourceFolderName} compiled successfully. (${resourceRootDir})`);
				return;
			}
		}

		vscode.window.showInformationMessage('Not found meta.xml file in parent directories.');
	});

	const compileFileCommand = vscode.commands.registerCommand('mta-resource-compiler.compileFile', async () => {
		const activeTextEditor = vscode.window.activeTextEditor;
		if (!activeTextEditor) {
			vscode.window.showErrorMessage('You must have a file open to compile it.');
			return;
		}
		const currentFile = activeTextEditor.document.uri.fsPath;
		const fileExt = path.extname(currentFile);
		if (fileExt !== '.lua') {
			vscode.window.showErrorMessage('Only lua files can be compiled.');
			return;
		}

		const formData = new FormData();
		formData.append("compile", "1");
		formData.append("debug", "0");
		formData.append("obfuscate", "3");
		const fileBuffer = fs.readFileSync(currentFile);
		formData.append("luasource", new File([fileBuffer], path.basename(currentFile)));

		vscode.window.showInformationMessage(`Compiling ${path.basename(currentFile)}`);
		const res = await fetch("http://luac.mtasa.com/index.php", {
			method: "POST",
			body: formData
		});

		// Convert body to compiled lua
		if (!res.ok || res.body === null) {
			vscode.window.showErrorMessage('Error compiling file.');
			return;
		}

		const compiledFile = currentFile.replace('.lua', '.luac');
		const writer = fs.createWriteStream(compiledFile);
		Readable.fromWeb(res.body).pipe(writer);

		writer.on('finish', () => {
			vscode.window.showInformationMessage(`File compiled successfully. (${compiledFile})`);
		});
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(compileFileCommand);
}

// This method is called when your extension is deactivated
export function deactivate() { }
