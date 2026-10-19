param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("play", "pause", "state")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [long]$WindowHandle,

    [switch]$FocusWindow
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class DouyinPlaybackMetrics
{
    public string State;
    public double ContentChangedRatio;
    public double ContentAverageDiff;
    public int TimestampChangedSamples;
    public int ProgressChangedSamples;
    public int SampleDurationMs;
}

[ComImport, Guid("56FDF342-FD6D-11d0-958A-006097C9A090"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ITaskbarList
{
    void HrInit();
    void AddTab(IntPtr hwnd);
    void DeleteTab(IntPtr hwnd);
    void ActivateTab(IntPtr hwnd);
    void SetActiveAlt(IntPtr hwnd);
}

[ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
public class TaskbarList
{
}

public static class DouyinAppControl
{
    private const uint WM_MOUSEMOVE = 0x0200;
    private const uint WM_LBUTTONDOWN = 0x0201;
    private const uint WM_LBUTTONUP = 0x0202;
    private const uint PW_RENDERFULLCONTENT = 0x00000002;
    private const int SW_RESTORE = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(
        IntPtr hWndParent,
        EnumWindowsProc callback,
        IntPtr lParam
    );

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(
        IntPtr hWnd,
        StringBuilder text,
        int count
    );

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(
        IntPtr hWnd,
        IntPtr hdcBlt,
        uint flags
    );

    [DllImport("user32.dll")]
    private static extern bool PostMessage(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        IntPtr lParam
    );

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    static DouyinAppControl()
    {
        try
        {
            SetProcessDPIAware();
        }
        catch
        {
        }
    }

    public static IntPtr FindRenderWindow(IntPtr parent)
    {
        IntPtr bestHandle = IntPtr.Zero;
        long bestArea = 0;

        EnumChildWindows(
            parent,
            delegate(IntPtr child, IntPtr unused)
            {
                StringBuilder className = new StringBuilder(256);
                GetClassName(child, className, className.Capacity);
                if (
                    className.ToString() != "Chrome_RenderWidgetHostHWND"
                    || !IsWindowVisible(child)
                )
                {
                    return true;
                }

                RECT rect;
                if (!GetClientRect(child, out rect))
                {
                    return true;
                }

                long area = Math.Max(0, rect.Right - rect.Left)
                    * (long)Math.Max(0, rect.Bottom - rect.Top);
                if (area > bestArea)
                {
                    bestArea = area;
                    bestHandle = child;
                }
                return true;
            },
            IntPtr.Zero
        );

        if (bestHandle == IntPtr.Zero || bestArea <= 0)
        {
            throw new InvalidOperationException(
                "Douyin render widget was not found."
            );
        }
        return bestHandle;
    }

    public static void RestoreWindow(IntPtr windowHandle)
    {
        if (IsIconic(windowHandle))
        {
            ShowWindowAsync(windowHandle, SW_RESTORE);
            Thread.Sleep(350);
        }
    }

    public static bool FocusWindow(IntPtr windowHandle)
    {
        EnsureTaskbarButton(windowHandle);
        ShowWindowAsync(windowHandle, SW_RESTORE);
        IntPtr foreground = GetForegroundWindow();
        uint foregroundProcess;
        uint foregroundThread = GetWindowThreadProcessId(foreground, out foregroundProcess);
        uint currentThread = GetCurrentThreadId();
        bool attached = AttachThreadInput(foregroundThread, currentThread, true);
        try
        {
            BringWindowToTop(windowHandle);
            SetForegroundWindow(windowHandle);
        }
        finally
        {
            if (attached)
            {
                AttachThreadInput(foregroundThread, currentThread, false);
            }
        }
        Thread.Sleep(120);
        return GetForegroundWindow() == windowHandle;
    }

    private static void EnsureTaskbarButton(IntPtr windowHandle)
    {
        ITaskbarList taskbar = null;
        try
        {
            taskbar = (ITaskbarList)new TaskbarList();
            taskbar.HrInit();
            taskbar.AddTab(windowHandle);
        }
        catch
        {
            // Focus and playback control still work if Explorer is restarting.
        }
        finally
        {
            if (taskbar != null && Marshal.IsComObject(taskbar))
            {
                Marshal.FinalReleaseComObject(taskbar);
            }
        }
    }

    public static void ClickVideo(IntPtr renderWindow)
    {
        RECT rect;
        if (!GetClientRect(renderWindow, out rect))
        {
            throw new InvalidOperationException(
                "Unable to read the Douyin render window size."
            );
        }

        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width < 320 || height < 240)
        {
            throw new InvalidOperationException(
                "Douyin render window is too small to control."
            );
        }

        int x = (int)Math.Round(width * 0.35);
        int y = (int)Math.Round(height * 0.52);
        IntPtr position = MakePosition(x, y);

        PostMessage(renderWindow, WM_MOUSEMOVE, IntPtr.Zero, position);
        Thread.Sleep(60);
        PostMessage(renderWindow, WM_LBUTTONDOWN, new IntPtr(1), position);
        Thread.Sleep(90);
        PostMessage(renderWindow, WM_LBUTTONUP, IntPtr.Zero, position);
    }

    public static DouyinPlaybackMetrics MeasurePlayback(IntPtr renderWindow)
    {
        int startedAt = Environment.TickCount;
        using (Bitmap before = Capture(renderWindow))
        {
            Thread.Sleep(800);
            using (Bitmap after = Capture(renderWindow))
            {
                RegionStats content = CompareRegion(
                    before,
                    after,
                    0.18,
                    0.13,
                    0.58,
                    0.66,
                    4
                );
                RegionStats timestamp = CompareRegion(
                    before,
                    after,
                    0.095,
                    0.925,
                    0.105,
                    0.07,
                    2
                );
                RegionStats progress = CompareRegion(
                    before,
                    after,
                    0.20,
                    0.93,
                    0.53,
                    0.065,
                    4
                );

                bool contentMoving = content.ChangedRatio >= 0.0025;
                bool timeMoving = timestamp.ChangedSamples >= 2;
                bool progressMoving = progress.ChangedSamples >= 12;

                DouyinPlaybackMetrics metrics = new DouyinPlaybackMetrics();
                metrics.State = contentMoving || timeMoving || progressMoving
                    ? "playing"
                    : "paused";
                metrics.ContentChangedRatio = Math.Round(
                    content.ChangedRatio,
                    5
                );
                metrics.ContentAverageDiff = Math.Round(
                    content.AverageDiff,
                    2
                );
                metrics.TimestampChangedSamples = timestamp.ChangedSamples;
                metrics.ProgressChangedSamples = progress.ChangedSamples;
                metrics.SampleDurationMs = Environment.TickCount - startedAt;
                return metrics;
            }
        }
    }

    private sealed class RegionStats
    {
        public double ChangedRatio;
        public double AverageDiff;
        public int ChangedSamples;
    }

    private static RegionStats CompareRegion(
        Bitmap before,
        Bitmap after,
        double leftRatio,
        double topRatio,
        double widthRatio,
        double heightRatio,
        int sampleStep
    )
    {
        int left = Math.Max(0, Math.Min(before.Width - 1, (int)(before.Width * leftRatio)));
        int top = Math.Max(0, Math.Min(before.Height - 1, (int)(before.Height * topRatio)));
        int width = Math.Max(
            1,
            Math.Min(before.Width - left, (int)(before.Width * widthRatio))
        );
        int height = Math.Max(
            1,
            Math.Min(before.Height - top, (int)(before.Height * heightRatio))
        );
        Rectangle rect = new Rectangle(left, top, width, height);
        BitmapData beforeData = before.LockBits(
            rect,
            ImageLockMode.ReadOnly,
            PixelFormat.Format32bppArgb
        );
        BitmapData afterData = after.LockBits(
            rect,
            ImageLockMode.ReadOnly,
            PixelFormat.Format32bppArgb
        );

        int byteCount = Math.Abs(beforeData.Stride) * height;
        byte[] beforeBytes = new byte[byteCount];
        byte[] afterBytes = new byte[byteCount];
        try
        {
            Marshal.Copy(beforeData.Scan0, beforeBytes, 0, byteCount);
            Marshal.Copy(afterData.Scan0, afterBytes, 0, byteCount);
        }
        finally
        {
            before.UnlockBits(beforeData);
            after.UnlockBits(afterData);
        }

        int changedSamples = 0;
        int samples = 0;
        long totalDiff = 0;
        for (int y = 0; y < height; y += sampleStep)
        {
            int row = y * beforeData.Stride;
            for (int x = 0; x < width; x += sampleStep)
            {
                int index = row + x * 4;
                int difference =
                    Math.Abs(beforeBytes[index] - afterBytes[index])
                    + Math.Abs(beforeBytes[index + 1] - afterBytes[index + 1])
                    + Math.Abs(beforeBytes[index + 2] - afterBytes[index + 2]);
                totalDiff += difference;
                if (difference > 24)
                {
                    changedSamples++;
                }
                samples++;
            }
        }

        RegionStats stats = new RegionStats();
        stats.ChangedSamples = changedSamples;
        stats.ChangedRatio = samples == 0 ? 0 : (double)changedSamples / samples;
        stats.AverageDiff = samples == 0 ? 0 : (double)totalDiff / samples;
        return stats;
    }

    private static Bitmap Capture(IntPtr renderWindow)
    {
        RECT rect;
        if (!GetClientRect(renderWindow, out rect))
        {
            throw new InvalidOperationException(
                "Unable to read the Douyin render window size."
            );
        }

        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0)
        {
            throw new InvalidOperationException(
                "Douyin render window size is invalid."
            );
        }

        Bitmap bitmap = new Bitmap(
            width,
            height,
            PixelFormat.Format32bppArgb
        );
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            IntPtr hdc = graphics.GetHdc();
            try
            {
                if (!PrintWindow(renderWindow, hdc, PW_RENDERFULLCONTENT))
                {
                    throw new InvalidOperationException(
                        "Unable to capture the Douyin video frame."
                    );
                }
            }
            finally
            {
                graphics.ReleaseHdc(hdc);
            }
        }
        return bitmap;
    }

    private static IntPtr MakePosition(int x, int y)
    {
        return new IntPtr((y << 16) | (x & 0xffff));
    }
}
'@

function Get-PlaybackMetrics {
    param([IntPtr]$RenderWindow)

    return [DouyinAppControl]::MeasurePlayback($RenderWindow)
}

function Test-DesiredState {
    param(
        [string]$State,
        [string]$DesiredState
    )

    return $State -eq $DesiredState
}

try {
    $window = [IntPtr]$WindowHandle
    [DouyinAppControl]::RestoreWindow($window)
    if ($FocusWindow -and -not [DouyinAppControl]::FocusWindow($window)) {
        throw "Unable to focus the Douyin window."
    }
    $renderWindow = [DouyinAppControl]::FindRenderWindow($window)
    $metrics = Get-PlaybackMetrics -RenderWindow $renderWindow
    $state = $metrics.State
    $attempts = 0

    if ($Action -ne "state") {
        $desiredState = if ($Action -eq "play") { "playing" } else { "paused" }
        while (-not (Test-DesiredState -State $state -DesiredState $desiredState) -and $attempts -lt 2) {
            $attempts++
            [DouyinAppControl]::ClickVideo($renderWindow)
            Start-Sleep -Milliseconds 800
            $metrics = Get-PlaybackMetrics -RenderWindow $renderWindow
            $state = $metrics.State
        }

        if (-not (Test-DesiredState -State $state -DesiredState $desiredState)) {
            throw "Unable to verify that Douyin is $desiredState; reported state: $state."
        }
    }

    [pscustomobject]@{
        ok = $true
        action = $Action
        state = $state
        verified = $true
        attempts = $attempts
        method = "render-widget-click"
        windowHandle = $WindowHandle
        renderWindowHandle = $renderWindow.ToInt64()
        metrics = $metrics
    } | ConvertTo-Json -Depth 5 -Compress
}
catch {
    [pscustomobject]@{
        ok = $false
        action = $Action
        error = $_.Exception.Message
        windowHandle = $WindowHandle
    } | ConvertTo-Json -Depth 3 -Compress
    exit 1
}
