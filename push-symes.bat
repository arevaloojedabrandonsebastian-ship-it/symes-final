@echo off
cd /d "%~dp0"
echo === SYMES Deploy === > push-log.txt 2>&1

if exist .git\index.lock (
  del /f .git\index.lock >> push-log.txt 2>&1
  echo Lock eliminado >> push-log.txt
)

echo [1/3] Agregando archivos... >> push-log.txt
git add index.html >> push-log.txt 2>&1

echo [2/3] Commit... >> push-log.txt
git commit -m "feat: pagos pendientes por trabajador con boton Pagar + Historial de pagos" >> push-log.txt 2>&1

echo [3/3] Push a main... >> push-log.txt
git push origin main >> push-log.txt 2>&1

echo === FIN — Revisa symes-final.pages.dev en ~1 minuto === >> push-log.txt
type push-log.txt
pause
