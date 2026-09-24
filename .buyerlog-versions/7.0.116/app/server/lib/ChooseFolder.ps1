param(
    [switch]$NetworkMode,
    [switch]$ModernMode,
    [string]$InitialPath = ""
)

# ChooseFolder.ps1
# Buyer Log kaynak klasörü seçicisi.
#
# Amaç: Windows native FolderBrowserDialog penceresini, kullanıcının Buyer Log'da
# Source Folder düğmesine bastığı anda açık olan pencerenin ÖNÜNDE açmak.
#
# Node.js sunucusu arka planda çalışan ayrı bir process olduğu için yalnızca
# Form.TopMost=true kullanmak yeterli değildir. Burada iki katmanlı çözüm vardır:
# 1) Dialog'a, script başlarken foreground olan pencerenin HWND'si owner olarak verilir.
# 2) Dialog yaratıldıktan hemen sonra yalnızca bir kez TOPMOST -> NOTOPMOST "z-order pulse"
#    uygulanır ve foreground'a alınır. Böylece dialog önde açılır fakat kullanıcı başka
#    bir uygulamaya geçmek isterse kalıcı "always on top" davranışı oluşmaz.

Add-Type -AssemblyName System.Windows.Forms

$nativeType = @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public sealed class BuyerLogExternalWindow : IWin32Window
{
    public BuyerLogExternalWindow(IntPtr handle) { Handle = handle; }
    public IntPtr Handle { get; private set; }
}

public static class BuyerLogDialogFocus
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_SHOWWINDOW = 0x0040;

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    // FolderBrowserDialog WinForms altında çoğunlukla #32770 sınıfıyla açılır.
    // Yeni/Windows shell varyantlarında sınıf farklı olabileceği için aynı process'teki
    // ilk görünür pencereyi fallback olarak da tutuyoruz.
    public static bool PromoteCurrentProcessDialog(IntPtr expectedOwner)
    {
        const uint GW_OWNER = 4;
        uint currentPid = (uint)Process.GetCurrentProcess().Id;
        IntPtr owned = IntPtr.Zero;
        IntPtr preferred = IntPtr.Zero;
        IntPtr fallback = IntPtr.Zero;

        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;

            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid != currentPid) return true;

            if (fallback == IntPtr.Zero) fallback = hWnd;

            if (expectedOwner != IntPtr.Zero && GetWindow(hWnd, GW_OWNER) == expectedOwner)
            {
                owned = hWnd;
                return false;
            }

            var className = new StringBuilder(256);
            GetClassName(hWnd, className, className.Capacity);
            if (String.Equals(className.ToString(), "#32770", StringComparison.Ordinal))
            {
                preferred = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);

        IntPtr target = owned != IntPtr.Zero ? owned : (preferred != IntPtr.Zero ? preferred : fallback);
        if (target == IntPtr.Zero) return false;

        // Geçici TOPMOST darbesi Windows'un background-process z-order kısıtını aşmak
        // için kullanılır; hemen NOTOPMOST'a döndürülür. Dialog kalıcı always-on-top olmaz.
        uint flags = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW;
        SetWindowPos(target, HWND_TOPMOST, 0, 0, 0, 0, flags);
        SetWindowPos(target, HWND_NOTOPMOST, 0, 0, 0, 0, flags);
        BringWindowToTop(target);
        SetForegroundWindow(target);
        return true;
    }
}
"@
Add-Type -TypeDefinition $nativeType -ReferencedAssemblies "System.Windows.Forms.dll"

if ($NetworkMode -or $ModernMode) {
    # Windows PowerShell 5'te FolderBrowserDialog eski ağaç görünümünü kullanır ve
    # UNC/ağ konumlarını güvenilir biçimde gezdirmez. OpenFileDialog modern Shell
    # görünümünü, adres çubuğunu ve Network konumlarını sunar. Sahte dosya adı,
    # kullanıcının içinde bulunduğu klasörü sonuç olarak almamızı sağlar.
    $networkDialog = New-Object System.Windows.Forms.OpenFileDialog
    $networkDialog.Title = $(if ($NetworkMode) { "Ortak Sync ağ klasörünü seçin (klasörün içine girip Aç'a basın)" } else { "Kaynak klasörünü seçin (klasörün içine girip Aç'a basın)" })
    $networkDialog.CheckFileExists = $false
    $networkDialog.CheckPathExists = $true
    $networkDialog.ValidateNames = $false
    $networkDialog.Multiselect = $false
    $networkDialog.DereferenceLinks = $true
    $networkDialog.FileName = "Bu klasörü seç"
    if ($InitialPath -and (Test-Path -LiteralPath $InitialPath -PathType Container)) {
        $networkDialog.InitialDirectory = $InitialPath
    }
    $dialog = $networkDialog
} else {
    $folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $folderDialog.Description = "ASAS ve Antrepo Excel dosyalarinin bulundugu (veya bulunacagi) klasoru sec"
    $folderDialog.ShowNewFolderButton = $true
    if ($InitialPath -and (Test-Path -LiteralPath $InitialPath -PathType Container)) {
        $folderDialog.SelectedPath = $InitialPath
    }
    $dialog = $folderDialog
}

# Kullanıcı düğmeye bastığı anda foreground'da olan pencere normalde Buyer Log'un
# tarayıcı penceresidir. Native dialog'u bu HWND'ye modal owner olarak bağlarız.
$foregroundHandle = [BuyerLogDialogFocus]::GetForegroundWindow()
$script:folderDialogForegroundHandle = $foregroundHandle
$owner = $null
if ($foregroundHandle -ne [IntPtr]::Zero) {
    $owner = New-Object BuyerLogExternalWindow -ArgumentList $foregroundHandle
}

# ShowDialog kendi nested Windows message loop'unu çalıştırdığı için WinForms Timer
# dialog görünür olur olmaz çalışmaya devam eder. En fazla kısa bir süre poll eder ve
# pencereyi bulduğu ilk anda öne getirip kendini kapatır.
$focusTimer = New-Object System.Windows.Forms.Timer
$focusTimer.Interval = 40
$script:folderDialogFocusAttempts = 0
$focusTimer.Add_Tick({
    $script:folderDialogFocusAttempts++
    if ([BuyerLogDialogFocus]::PromoteCurrentProcessDialog($script:folderDialogForegroundHandle) -or $script:folderDialogFocusAttempts -ge 25) {
        $focusTimer.Stop()
    }
})

try {
    $focusTimer.Start()
    if ($null -ne $owner) {
        $result = $dialog.ShowDialog($owner)
    } else {
        $result = $dialog.ShowDialog()
    }

    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        if ($NetworkMode -or $ModernMode) {
            $selected = $networkDialog.FileName
            if (Test-Path -LiteralPath $selected -PathType Container) {
                Write-Output $selected
            } else {
                Write-Output (Split-Path -Parent $selected)
            }
        } else {
            Write-Output $folderDialog.SelectedPath
        }
    } else {
        Write-Output ""
    }
}
finally {
    try { $focusTimer.Stop() } catch {}
    try { $focusTimer.Dispose() } catch {}
    try { $dialog.Dispose() } catch {}
}
