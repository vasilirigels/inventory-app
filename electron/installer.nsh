; Custom NSIS macros për ChamShop installer.
;
; SHKAKU: NSIS-i i electron-builder-it (_CHECK_APP_RUNNING) bën:
;   1. taskkill soft
;   2. Sleep 300
;   3. taskkill /F
;   4. Sleep 2000
;   5. Nëse procesi ende gjallë → dialog "Cham Shop non può essere chiuso"
;
; Server-i ynë i brendshëm spawn-ohet me process.execPath = Cham Shop.exe.
; Përveç main window-it, ka edhe child-in (server) + native workers (libsql).
; Këta marrin > 2 sekonda për të dalë plotësisht, ndaj NSIS dorezohet dhe
; shfaq dialog-un.
;
; ZGJIDHJA: `customCheckAppRunning` ZËVENDËSON krejt check-un e brendshëm.
; Bëjmë vetë taskkill /F /T (tree) + sleep të mjaftueshëm, pa dialog.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 2000
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 1000
!macroend

; preInit ekzekutohet në krye të .onInit — mburojë shtesë për të vrarë
; procese që mund të spawn-ohen midis check-ut dhe install-it.
!macro preInit
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 500
!macroend

; Njësoj për uninstall.
!macro customUnInit
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 1500
!macroend
