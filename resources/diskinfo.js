// Reports the total and free bytes of a Windows volume, one value per line.
//
//   cscript //nologo //E:jscript diskinfo.js C:
//
// This exists so platform.utils.ts can read disk capacity without PowerShell, whose ~400ms
// cold start blocked the Electron main process every poll (badly on mechanical drives).
// Scripting.FileSystemObject returns raw numbers, so unlike `dir` or `typeperf` the output
// carries no localised text or decimal separators to parse around.
//
// Windows-only: on Linux platform.utils.ts uses `df` and never looks for this file.
var drive = WScript.Arguments.length > 0 ? WScript.Arguments(0) : 'C:';
var fso = new ActiveXObject('Scripting.FileSystemObject');
var volume = fso.GetDrive(drive);
WScript.Echo(volume.TotalSize);
WScript.Echo(volume.FreeSpace);
