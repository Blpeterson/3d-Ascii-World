$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    Write-Host "[1/3] Checking JavaScript syntax"
    node --check game.js

    Write-Host "[2/3] Checking launchers"
    node --check server.mjs
    if (Get-Command python -ErrorAction SilentlyContinue) {
        python -m py_compile server.py
    } elseif (Get-Command py -ErrorAction SilentlyContinue) {
        py -3 -m py_compile server.py
    } else {
        Write-Host "Python not installed; Node launcher is ready." -ForegroundColor DarkYellow
    }

    Write-Host "[3/3] Checking required game hooks"
    $game = Get-Content -Raw game.js
    @("tileAt", "castRay", "castRayLayers", "castRoofRay", "cameraBlocked", "projectWorldHeight", "unprojectScreenHeight", "updateWalking", "updateCar", "updateView", "toggleCar", "truckCollides", "rayOrientedBox", "renderDynamicModels") | ForEach-Object {
        if ($game -notmatch "function\s+$($_)\s*\(") { throw "Missing required function: $_" }
    }
    Write-Host "Validation passed." -ForegroundColor Green
} finally {
    Pop-Location
}
