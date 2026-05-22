using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace DeerFlowLocalDevGuiLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            try
            {
                string exeDir = Path.GetDirectoryName(Application.ExecutablePath) ?? AppDomain.CurrentDomain.BaseDirectory;
                string guiScriptPath = Path.Combine(exeDir, "dev-local-gui.ps1");

                if (!File.Exists(guiScriptPath))
                {
                    MessageBox.Show(
                        "未找到 GUI 脚本:\n" + guiScriptPath + "\n\n请确保 dev-local-gui.exe 与 dev-local-gui.ps1 位于同一目录。",
                        "DeerFlow Local Dev GUI",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File \"" + guiScriptPath + "\"",
                    WorkingDirectory = exeDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };

                using (var process = Process.Start(psi))
                {
                    if (process == null)
                    {
                        MessageBox.Show(
                            "无法启动 PowerShell 进程。",
                            "DeerFlow Local Dev GUI",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                        return;
                    }

                    // If the script exits immediately, show diagnostic output
                    // so users do not see a "no response" behavior.
                    if (process.WaitForExit(2000))
                    {
                        string stdout = process.StandardOutput.ReadToEnd();
                        string stderr = process.StandardError.ReadToEnd();
                        if (process.ExitCode != 0)
                        {
                            string details = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                            if (string.IsNullOrWhiteSpace(details))
                            {
                                details = "No additional error output.";
                            }

                            MessageBox.Show(
                                "GUI 启动失败，PowerShell 进程已退出。\n\nExitCode: " + process.ExitCode + "\n\n" + details,
                                "DeerFlow Local Dev GUI",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Error
                            );
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "启动失败:\n" + ex.Message,
                    "DeerFlow Local Dev GUI",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
