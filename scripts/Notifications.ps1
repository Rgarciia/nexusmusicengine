<#
.SYNOPSIS
    Módulo para enviar notificaciones nativas de Windows.
#>

function Send-ToastNotification {
    param (
        [string]$Title = "MusicImporter",
        [string]$Message
    )

    try {
        # Intento 1: Toast API WinRT nativo utilizando el AppID de PowerShell
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02
        $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)
        
        $text = $xml.GetElementsByTagName("text")
        $text.Item(0).AppendChild($xml.CreateTextNode($Title)) | Out-Null
        $text.Item(1).AppendChild($xml.CreateTextNode($Message)) | Out-Null

        # Usar el AppID nativo de PowerShell para evitar bloqueos del sistema
        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe")
        $notification = [Windows.UI.Notifications.ToastNotification]::new($xml)
        $notifier.Show($notification)
    }
    catch {
        try {
            # Intento 2: Fallback rápido mediante Windows Script Host (Balloon Notification)
            $wshell = New-Object -ComObject Wscript.Shell
            $wshell.Popup($Message, 5, $Title, 64) | Out-Null
        }
        catch {
            # Salida limpia si las notificaciones de escritorio están deshabilitadas en Windows
        }
    }
}