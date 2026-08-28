; Custom NSIS macros për ChamShop installer.
;
; SHKAKU: NSIS-i i electron-builder-it bën taskkill + sleep ~2s → nëse procesi
; ende gjallë ose file handles jo të liruara, shfaq dialog-un
; "Cham Shop non può essere chiuso".
;
; Dialog-u mund të dalë nga 3 vende:
;   1. _CHECK_APP_RUNNING loop → bllokuar nga customCheckAppRunning (këtu)
;   2. extractAppPackage.nsh (file copy fail 5 herë) → nevojitet wait më i gjatë
;   3. installUtil.nsh (old uninstaller fail 5 herë) → njësoj
;
; Server-i ynë spawn-ohet me process.execPath = "Cham Shop.exe" (v1.0.57 e më
; poshtë) ose brenda main-it (v1.0.58+). Plus libsql native workers. Këta
; mbajnë file handles deri disa sekonda pas kill-it. Antivirus ndoshta i mban
; edhe më gjatë. Ndaj bëjmë 5 raunde kill me sleep 1s + final wait 5s =
; ~10s total para se extract-i të nisë.

!macro customCheckAppRunning
  ; Round 1-5: taskkill /F /T (force + tree) — kill main + tërë children.
  ; Nëse procesi s'ekziston, taskkill kthen 128 dhe vazhdon (ignorohet).
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 1000
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 1000
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 1000
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 1000
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  ; Final wait — jep OS-it kohë të lirojë të gjitha file handles.
  ; Pa këtë, extractAppPackage.nsh mund të fail-ojë me "file in use"
  ; edhe pse procesi ka dalë me kohë.
  Sleep 5000
!macroend

; preInit ekzekutohet në krye të .onInit — mburoja e parë (para
; ALLOW_ONLY_ONE_INSTALLER_INSTANCE). Shpejt (500ms) sepse
; customCheckAppRunning bën wait-in e gjatë vetë.
!macro preInit
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 500
!macroend

; customInit ekzekutohet mes ALLOW_ONLY_ONE_INSTALLER_INSTANCE dhe Section
; install — mburojë shtesë për procese që mund të kenë respawn-uar
; (p.sh. auto-restart nga Windows, ose ndonjë instancë e re nga user-i).
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 500
!macroend

; customUnInit — njësoj për uninstall standalone (jo për upgrade flow-in).
!macro customUnInit
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 2000
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 2000
  nsExec::Exec 'taskkill /F /T /IM "Cham Shop.exe"'
  Sleep 2000
!macroend
