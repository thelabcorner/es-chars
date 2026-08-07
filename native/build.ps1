# Build ESChars native components.
#   Default:  ESChars.dll (ExtendScript ExternalObject; PE64, /LD)
#   -Cli:      ESChars-cli.exe (console differential harness; /SUBSYSTEM:CONSOLE)
# Finds the MSVC toolchain (VS2019/VS2022 BuildTools) + Windows SDK automatically.
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1 [-Name ESChars2.dll] [-Cli]

param(
    [string]$Name = "ESChars.dll",
    [switch]$Cli
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-VsDevCmd {
    $candidates = @(
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    throw "VsDevCmd.bat not found - install 'Desktop development with C++' (Build Tools)"
}

$devcmd = Find-VsDevCmd
$vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($install) {
        $c = Join-Path $install "Common7\Tools\VsDevCmd.bat"
        if (Test-Path $c) { $devcmd = $c }
    }
}

# Capture the environment vcvars64 sets, then build inside it.
$envBlock = cmd /c "`"$devcmd`" -arch=x64 -host_arch=x64 >nul 2>&1 && set" 
$envBlock | ForEach-Object {
    if ($_ -match "^(.*?)=(.*)$") {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

$outDir = Join-Path $here "bin"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Numbered output name: a loaded DLL stays locked until the host app exits
# (LNK1104). Pass -Name ESChars2.dll to build an iteration without closing
# Illustrator. Default keeps the canonical name.
$dllName = "ESChars.dll"
if ($Name) { $dllName = $Name }

if ($Cli) {
    $src = Join-Path $here "eschars-cli.c"
    $out = Join-Path $outDir "ESChars-cli.exe"
    & cl /nologo /O2 /W3 /Fe:"$out" "$src" /link /SUBSYSTEM:CONSOLE /OUT:"$out"
    if ($LASTEXITCODE -ne 0) { throw "cl failed with exit $LASTEXITCODE" }
    Write-Output ""
    Write-Output "Built: $out"
}
else {
    $src = Join-Path $here "eschars.c"
    $out = Join-Path $outDir $dllName
    & cl /nologo /O2 /LD /W3 /Fe:"$out" "$src" /link /SUBSYSTEM:WINDOWS /OUT:"$out"
    if ($LASTEXITCODE -ne 0) { throw "cl failed with exit $LASTEXITCODE" }
    Write-Output ""
    Write-Output "Built: $out"
    & dumpbin /exports $out | Select-Object -First 20
}
