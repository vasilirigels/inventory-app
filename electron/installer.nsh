; Custom NSIS macros për ChamShop installer.
;
; PROBLEMI: Server-i i brendshëm spawn-ohet me process.execPath = Cham Shop.exe.
; NSIS-i standard i electron-builder-it (CheckAppIsRunning) detekton këtë child
; si proces më vete dhe shfaq dialog-un "Cham Shop non può essere chiuso" edhe
; kur main window është mbyllur — sepse child-i mund të mbetet gjallë disa
; sekonda pas quitAndInstall.
;
; ZGJIDHJA: `preInit` ekzekutohet në krye të .onInit, PARA CheckAppIsRunning.
; Bëjmë taskkill /F /T /IM "Cham Shop.exe" që të vrasim tërë tree-in me forcë.
; Pastaj sleep 500ms që OS-i të pastrojë handle-t, dhe CheckAppIsRunning pastaj
; s'gjen asnjë proces → instalimi vazhdon pa dialog.
;
; `/F` = force, `/T` = tree (kill child processes too), `/IM` = image name.
; Errors ignorohen — nëse s'ka procese, taskkill kthen exit code 128.

!macro preInit
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 500
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 500
!macroend
