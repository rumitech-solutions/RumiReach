[CmdletBinding()]
param(
    [switch]$PruneBuildCache
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Push-Location $repoRoot
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI was not found. Install/start Docker Desktop first."
    }

    $null = docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Engine is not running. Start Docker Desktop and run this script again."
    }

    Write-Host "Stopping/removing this RumiReach Compose project's containers and network..."
    docker compose down --remove-orphans
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose down failed."
    }

    Write-Host "Removing dangling Docker images..."
    docker image prune --force
    if ($LASTEXITCODE -ne 0) {
        throw "Docker image cleanup failed."
    }

    if ($PruneBuildCache) {
        Write-Warning "This clears unused Docker build cache for all projects on this computer."
        docker builder prune --all --force
        if ($LASTEXITCODE -ne 0) {
            throw "Docker build-cache cleanup failed."
        }
    }

    Write-Host ""
    Write-Host "Cleanup complete."
    Write-Host "RumiReach database and WhatsApp-session volumes were preserved."
    Write-Host "Start the app again with: docker compose up -d --build"
}
finally {
    Pop-Location
}
