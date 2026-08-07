@echo off
cd /d "%~dp0"
echo === SYMES Deploy === > push-log.txt 2>&1

if exist .git\index.lock (
  del /f .git\index.lock >> push-log.txt 2>&1
  echo Lock index eliminado >> push-log.txt
)
if exist .git\HEAD.lock (
  del /f .git\HEAD.lock >> push-log.txt 2>&1
  echo Lock HEAD eliminado >> push-log.txt
)

echo [1/5] Agregando archivos... >> push-log.txt
git add -A >> push-log.txt 2>&1

echo [2/5] Commit... >> push-log.txt
git commit -m "chore: update symes" >> push-log.txt 2>&1

echo [3/5] Push a GitHub... >> push-log.txt
git push origin main >> push-log.txt 2>&1

echo [4/5] Deploy a Cloudflare Pages... >> push-log.txt
npx wrangler pages deploy . --project-name=symes-final --branch=main --commit-dirty=true >> push-log.txt 2>&1

echo [5/5] Obteniendo deployments y promoviendo a produccion... >> push-log.txt
npx wrangler pages deployment list --project-name=symes-final > deploy-list.txt 2>&1
type deploy-list.txt >> push-log.txt

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$list = Get-Content 'deploy-list.txt' -Raw; " ^
  "$uuidMatch = [regex]::Match($list, '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'); " ^
  "if (-not $uuidMatch.Success) { Write-Host 'ERROR: no se encontro UUID de deployment'; exit 1 } " ^
  "$depId = $uuidMatch.Value; " ^
  "Write-Host \"Deployment UUID: $depId\"; " ^
  "$cfgPath = \"$env:USERPROFILE\.wrangler\config\default.toml\"; " ^
  "if (-not (Test-Path $cfgPath)) { $cfgPath = \"$env:APPDATA\wrangler\config\default.toml\" }; " ^
  "$cfg = Get-Content $cfgPath -Raw -ErrorAction SilentlyContinue; " ^
  "$tok = [regex]::Match($cfg, 'oauth_token\s*=\s*\"(.+?)\"'); " ^
  "if (-not $tok.Success) { Write-Host 'ERROR: token no encontrado en ' + $cfgPath; exit 1 } " ^
  "$token = $tok.Groups[1].Value; " ^
  "$acct = '3f7c9500199ebe7817ae0875b86d6ea0'; " ^
  "$proj = 'symes-final'; " ^
  "$url = \"https://api.cloudflare.com/client/v4/accounts/$acct/pages/projects/$proj/deployments/$depId/rollback\"; " ^
  "$h = @{ Authorization = \"Bearer $token\"; 'Content-Type' = 'application/json' }; " ^
  "$r = Invoke-RestMethod -Uri $url -Method POST -Headers $h -Body '{}' -ErrorAction SilentlyContinue; " ^
  "if ($r.success) { Write-Host 'PRODUCCION ACTUALIZADA exitosamente' } else { Write-Host 'Respuesta CF: ' + ($r | ConvertTo-Json -Depth 3) }" ^
  >> push-log.txt 2>&1

echo === FIN === >> push-log.txt
if exist deploy-list.txt del deploy-list.txt 2>nul
type push-log.txt
pause
