@echo off
cd /d "%~dp0"
echo === SYMES Deploy — Feature_Andrey to main === > push-log.txt 2>&1

if exist .git\index.lock (
  del /f .git\index.lock >> push-log.txt 2>&1
  echo Lock eliminado >> push-log.txt
)

echo [1/5] Agregando archivos... >> push-log.txt
git add index.html worker-endpoint-reset-password.js sitemap.xml >> push-log.txt 2>&1

echo [2/5] Commit (si hay cambios pendientes)... >> push-log.txt
git commit -m "feat: planilla soporte 3 y 4 trabajadores, pago dividido equitativamente" >> push-log.txt 2>&1

echo [3/5] Push Feature_Andrey... >> push-log.txt
git push origin Feature_Andrey >> push-log.txt 2>&1

echo [4/5] Merge a main... >> push-log.txt
git checkout main >> push-log.txt 2>&1
git pull origin main >> push-log.txt 2>&1
git merge Feature_Andrey --no-ff -m "merge: Feature_Andrey -> main (todos los fixes)" >> push-log.txt 2>&1

echo [5/5] Push main (dispara deploy en Cloudflare Pages)... >> push-log.txt
git push origin main >> push-log.txt 2>&1

git checkout Feature_Andrey >> push-log.txt 2>&1
echo === FIN — Revisa symes-final.pages.dev en ~1 minuto === >> push-log.txt 2>&1
type push-log.txt
pause
