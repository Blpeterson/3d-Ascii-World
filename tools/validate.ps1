$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    Write-Host "[1/4] Checking JavaScript syntax"
    node --check game.js
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed." }

    Write-Host "[2/4] Checking launchers"
    node --check server.mjs
    if ($LASTEXITCODE -ne 0) { throw "Node launcher syntax check failed." }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        python -m py_compile server.py
        if ($LASTEXITCODE -ne 0) { throw "Python launcher syntax check failed." }
    } elseif (Get-Command py -ErrorAction SilentlyContinue) {
        py -3 -m py_compile server.py
        if ($LASTEXITCODE -ne 0) { throw "Python launcher syntax check failed." }
    } else {
        Write-Host "Python not installed; Node launcher is ready." -ForegroundColor DarkYellow
    }

    Write-Host "[3/4] Checking required game hooks"
    $game = Get-Content -Raw game.js
    @("tileAt", "neighborhoodAt", "buildingDescriptor", "externalRampAt", "rampSurfaceHeight", "exteriorRampBand", "walkingSurfaceHeight", "walkingBlocked", "roofEdgeBlocked", "recoverStuckPlayer", "castRay", "castRayLayers", "castRoofRay", "cameraBlocked", "projectWorldHeight", "unprojectScreenHeight", "updateWalking", "updateVehicleChaseCamera", "updateCar", "updateHelicopter", "updateView", "toggleVehicle", "truckCollides", "helicopterBlocked", "rayOrientedBox", "renderDynamicModels", "renderHelicopterCockpit", "acceptPeerState", "connectMultiplayer", "sendNetworkState") | ForEach-Object {
        if ($game -notmatch "function\s+$($_)\s*\(") { throw "Missing required function: $_" }
    }
    Write-Host "[4/4] Running procedural and aerial smoke checks"
    node tools/smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw "Procedural/aerial smoke checks failed." }
    Write-Host "Validation passed." -ForegroundColor Green
} finally {
    Pop-Location
}
