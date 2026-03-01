# Troubleshooting Guide - Cerious AASM

## Table of Contents
1. [Common Issues](#common-issues)
2. [Installation Problems](#installation-problems)
3. [Server Issues](#server-issues)
4. [Network & Connectivity](#network--connectivity)
5. [Performance Problems](#performance-problems)
6. [Backup & Restore Issues](#backup--restore-issues)
7. [Error Codes](#error-codes)
8. [Log Analysis](#log-analysis)
9. [Advanced Troubleshooting](#advanced-troubleshooting)
10. [Getting Support](#getting-support)

## Common Issues

### Application Won't Start

**Symptoms**: Application fails to launch or crashes immediately

**Solutions**:
1. **Check System Requirements**:
   - Windows 10+ or recent Linux distribution
   - 4GB RAM minimum
   - 50GB free disk space
   - Administrative privileges

2. **Update Dependencies**:
   ```powershell
   # Windows - Update Visual C++ Redistributables
   # Download from Microsoft website
   
   # Linux - Update system libraries
   sudo apt update && sudo apt upgrade
   ```

3. **Run as Administrator** (Windows):
   - Right-click application → "Run as administrator"

4. **Check Antivirus**:
   - Whitelist the installation directory
   - Disable real-time scanning temporarily

### SteamCMD Download Fails

**Symptoms**: Initial setup fails, SteamCMD won't download

**Solutions**:
1. **Check Internet Connection**:
   - Verify stable internet connection
   - Test with other downloads

2. **Firewall Configuration**:
   ```powershell
   # Windows PowerShell (as Administrator)
   New-NetFirewallRule -DisplayName "Cerious AASM" -Direction Inbound -Protocol TCP -LocalPort 27015-27020 -Action Allow
   New-NetFirewallRule -DisplayName "SteamCMD" -Direction Outbound -Program "C:\path\to\steamcmd.exe" -Action Allow
   ```

3. **Manual SteamCMD Installation**:
   - Download SteamCMD manually from Valve
   - Extract to `installation_directory/steamcmd/`
   - Restart application

4. **Proxy/Corporate Network**:
   - Configure proxy settings in application settings
   - Contact IT department for Steam domain whitelist

### Server Files Won't Download

**Symptoms**: ARK server installation hangs or fails

**Solutions**:
1. **Disk Space**:
   - Ensure 25GB+ free space for ARK server files
   - Clean temporary files

2. **Steam Login Issues**:
   - Restart SteamCMD download
   - Check Steam server status

3. **Partial Download Recovery**:
   - Delete incomplete download folder
   - Restart installation process

4. **Network Timeout**:
   - Increase timeout settings in configuration
   - Try during off-peak hours

## Installation Problems

### Windows Installation Issues

**Error**: "Windows cannot verify the publisher of this software"
- **Solution**: Right-click installer → Properties → Unblock → OK

**Error**: "This app can't run on your PC"
- **Solution**: Ensure 64-bit Windows 10 or later

**Error**: Missing DLL files
- **Solution**: Install Visual C++ Redistributable 2019 or later

### Linux Installation Issues

**Error**: Permission denied
```bash
# Fix permissions
chmod +x cerious-aasm.AppImage
sudo chmod +x /opt/cerious-aasm/cerious-aasm
```

**Error**: Missing dependencies
```bash
# Ubuntu/Debian
sudo apt install libnss3 libatk-bridge2.0-0 libdrm2 libgtk-3-0

# CentOS/RHEL
sudo yum install nss atk at-spi2-atk gtk3
```

**Error**: AppImage won't run
```bash
# Enable FUSE
sudo apt install fuse
sudo modprobe fuse

# Or extract and run directly
./cerious-aasm.AppImage --appimage-extract
./squashfs-root/cerious-aasm
```

### Headless Mode Crashes on Linux (`Gtk-ERROR: Can't create a GtkStyleContext without a display connection`)

**Cause**: Electron initialises GTK at the native-binary level, *before* any
JavaScript runs.  GTK requires a live display connection (X11 or Wayland).
On a headless server where no display is available the process crashes
immediately with a core dump regardless of the `--headless` flag.

**Fix**: Use `xvfb-run` to create a virtual framebuffer that GTK can connect to.

1. **Install xvfb**:
   ```bash
   # Debian / Ubuntu
   sudo apt install xvfb

   # Fedora / RHEL / Rocky
   sudo dnf install xorg-x11-server-Xvfb
   ```

2. **AppImage / system-installed binary** – use the bundled helper script:
   ```bash
   # Copy the helper to a convenient location
   sudo cp /path/to/cerious-aasm-headless-appimage.sh /usr/local/bin/cerious-aasm-headless
   sudo chmod +x /usr/local/bin/cerious-aasm-headless

   # Run (the script auto-detects the binary and adds xvfb-run)
   cerious-aasm-headless --auth-enabled --password=admin123 --port=3000
   ```
   Or run directly without the script:
   ```bash
   xvfb-run -a cerious-aasm --no-sandbox --headless --auth-enabled --password=admin123 --port=3000
   ```

3. **Source / development builds** – use the existing helper script:
   ```bash
   ./scripts/cerious-aasm-headless.sh --auth-enabled --password=admin123 --port=3000
   ```
   The script detects that no display is present and invokes `xvfb-run -a` automatically.

4. **systemd service** – add the `xvfb-run` wrapper in the `ExecStart` line:
   ```ini
   [Service]
   ExecStart=/usr/bin/xvfb-run -a /usr/bin/cerious-aasm --no-sandbox --headless --auth-enabled --password=<password> --port=3000
   ```

## Server Issues

### Server Won't Start

**Symptoms**: Server status remains "Stopped" after start attempt

**Diagnostic Steps**:
1. **Check Server Logs**:
   - Open Logs section in application
   - Look for error messages in server startup

2. **Verify Port Availability**:
   ```powershell
   # Windows
   netstat -an | findstr "27015"
   
   # Linux
   netstat -ln | grep 27015
   ```

3. **Check File Integrity**:
   - Use "Validate Files" option in server settings
   - Redownload if validation fails

**Common Fixes**:
- **Port Conflict**: Change server port in configuration
- **Corrupted Files**: Validate/reinstall server files
- **Insufficient RAM**: Increase system memory or reduce server count
- **Firewall Blocking**: Configure firewall rules

### Server Crashes Frequently

**Symptoms**: Server stops unexpectedly, restarts automatically

**Diagnostic Steps**:
1. **Review Crash Logs**:
   - Check `Logs/Crashes/` directory
   - Look for consistent error patterns

2. **Monitor System Resources**:
   - Check RAM usage before crashes
   - Monitor CPU temperature

**Solutions**:
- **Memory Issues**: Increase RAM allocation or reduce max players
- **Mod Conflicts**: Disable mods one by one to identify conflicts
- **Overheating**: Improve system cooling
- **Schedule Restarts**: Regular restarts prevent memory leaks

### Players Can't Connect

**Symptoms**: Server appears online but players cannot join

**Diagnostic Steps**:
1. **Test Local Connection**:
   - Try connecting from same machine
   - Use server IP: `127.0.0.1:27015`

2. **Check External Connectivity**:
   - Test from different network
   - Use online port checker tools

**Solutions**:
1. **Router Configuration**:
   ```
   Port Forwarding Rules:
   TCP: 27015 (Game Port)
   TCP: 27020 (RCON Port)
   UDP: 7777-7778 (Query Ports)
   ```

2. **Firewall Rules**:
   ```powershell
   # Windows
   New-NetFirewallRule -DisplayName "ARK Server" -Direction Inbound -Protocol TCP -LocalPort 27015 -Action Allow
   New-NetFirewallRule -DisplayName "ARK Query" -Direction Inbound -Protocol UDP -LocalPort 7777-7778 -Action Allow
   ```

3. **Steam Visibility**:
   - Enable Steam server listing in settings
   - Wait 5-10 minutes for Steam discovery

## Network & Connectivity

### Web Interface Not Accessible

**Symptoms**: Cannot access web interface at localhost:3000

**Solutions**:
1. **Check Web Server Status**:
   - Verify web server is running in application logs
   - Check for port binding errors

2. **Port Conflicts**:
   ```powershell
   # Check if port 3000 is in use
   netstat -an | findstr "3000"
   ```
   - Change web interface port in settings

3. **Browser Issues**:
   - Try different browser
   - Clear browser cache and cookies
   - Disable browser extensions

4. **Firewall Blocking**:
   ```powershell
   # Allow web interface port
   New-NetFirewallRule -DisplayName "Cerious Web" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```

### RCON Connection Failed

**Symptoms**: Cannot connect to server console (RCON)

**Solutions**:
1. **Verify RCON Settings**:
   - Check RCON port in server configuration
   - Ensure RCON password is set

2. **Network Configuration**:
   - Allow RCON port through firewall
   - Check if another service uses the RCON port

3. **Server Status**:
   - RCON only works when server is running
   - Restart server if RCON stops responding

## Performance Problems

### High CPU Usage

**Symptoms**: Application or server consumes excessive CPU

**Solutions**:
1. **Reduce Server Load**:
   - Lower max player count
   - Reduce NPC/dino spawn rates
   - Disable resource-intensive mods

2. **System Optimization**:
   - Close unnecessary background applications
   - Set server process priority to "High"
   - Ensure adequate cooling

3. **Configuration Tuning**:
   ```
   Server Settings to Reduce CPU Load:
   - Lower view distance
   - Reduce structure limit
   - Disable certain visual effects
   ```

### Memory Leaks

**Symptoms**: RAM usage continuously increases over time

**Solutions**:
1. **Regular Restarts**:
   - Schedule daily server restarts
   - Restart application weekly

2. **Configuration Adjustments**:
   - Reduce memory-intensive settings
   - Lower player and structure limits

3. **Monitor Usage**:
   - Use Task Manager (Windows) or htop (Linux)
   - Track memory usage patterns

### Slow File Operations

**Symptoms**: Backup/restore operations take extremely long

**Solutions**:
1. **Storage Optimization**:
   - Use SSD instead of HDD
   - Defragment hard drives (HDD only)
   - Ensure sufficient free space

2. **Compression Settings**:
   - Reduce backup compression level
   - Use faster compression algorithms

3. **Antivirus Exclusions**:
   - Exclude installation directory from real-time scanning
   - Exclude backup directory from scanning

## Backup & Restore Issues

### Backup Creation Fails

**Symptoms**: Backup process starts but fails to complete

**Solutions**:
1. **Disk Space**:
   - Ensure adequate space in backup directory
   - Clean old backups automatically

2. **File Permissions**:
   ```powershell
   # Windows - Take ownership of server files
   takeown /f "C:\ARK-Servers" /r /d y
   icacls "C:\ARK-Servers" /grant Users:F /t
   ```

3. **Active File Locks**:
   - Stop server before creating backup
   - Close any file browsers in server directory

### Restore Operation Fails

**Symptoms**: Backup restore starts but doesn't complete

**Solutions**:
1. **Backup Integrity**:
   - Verify backup file isn't corrupted
   - Try restoring from different backup

2. **Server State**:
   - Ensure target server is completely stopped
   - Wait for all processes to close

3. **File Conflicts**:
   - Clear destination directory before restore
   - Check for read-only files

### Import/Export Issues

**Symptoms**: Server import fails or produces errors

**Solutions**:
1. **Version Compatibility**:
   - Ensure backup was created with compatible version
   - Check ARK server version compatibility

2. **Configuration Validation**:
   - Verify server configuration in backup
   - Update paths for new installation

## Error Codes

### Common Application Errors

**Error Code: STEAM_001**
- **Meaning**: SteamCMD initialization failed
- **Solution**: Reinstall SteamCMD, check network connectivity

**Error Code: SERVER_002**
- **Meaning**: Server startup timeout
- **Solution**: Increase startup timeout, check server files

**Error Code: BACKUP_003**
- **Meaning**: Backup operation permission denied
- **Solution**: Run as administrator, check file permissions

**Error Code: NETWORK_004**
- **Meaning**: Port binding failed
- **Solution**: Check port conflicts, change port configuration

**Error Code: FILE_005**
- **Meaning**: File system error
- **Solution**: Check disk space, verify file permissions

### ARK Server Errors

**"Failed to bind to port"**
- Port already in use by another application
- Change server port or stop conflicting application

**"Memory allocation failed"**
- Insufficient system RAM
- Reduce max players or increase system memory

**"Map not found"**
- Missing or corrupted map files
- Validate server files or reinstall

## Log Analysis

### Application Logs
Location: `%APPDATA%/cerious-aasm/logs/` (Windows) or `~/.config/cerious-aasm/logs/` (Linux)

**Important Log Files**:
- `main.log`: General application events
- `server-{id}.log`: Individual server logs
- `backup.log`: Backup/restore operations
- `error.log`: Application errors and exceptions

### Reading Log Patterns

**Normal Startup**:
```
[INFO] Application started successfully
[INFO] SteamCMD initialized
[INFO] Web server listening on port 3000
```

**Server Issues**:
```
[ERROR] Server failed to start: Port 27015 in use
[WARNING] High memory usage detected: 85%
[ERROR] Backup failed: Insufficient disk space
```

### Log Levels
- **DEBUG**: Detailed technical information
- **INFO**: General operational messages
- **WARNING**: Potential issues that don't stop operation
- **ERROR**: Problems that prevent normal operation
- **CRITICAL**: Severe errors that may crash the application

## Advanced Troubleshooting

### Process Monitoring

**Windows**:
```powershell
# Monitor ARK server processes
Get-Process | Where-Object {$_.ProcessName -like "*ARK*"}

# Check port usage
netstat -ano | findstr "27015"
```

**Linux**:
```bash
# Monitor processes
ps aux | grep -i ark

# Check port usage
ss -tuln | grep 27015

# Monitor system resources
htop
```

### Database Issues

**Symptoms**: Configuration not saving, application crashes on startup

**Solutions**:
1. **Reset Configuration**:
   ```powershell
   # Windows
   Remove-Item "$env:APPDATA\cerious-aasm\config.db" -Force
   
   # Linux
   rm ~/.config/cerious-aasm/config.db
   ```

2. **Backup Configuration**:
   - Export settings before major changes
   - Keep backup of working configuration

### Network Diagnostics

**Test Server Connectivity**:
```powershell
# Test game port
Test-NetConnection -ComputerName "your-server-ip" -Port 27015

# Test web interface
Test-NetConnection -ComputerName "localhost" -Port 3000
```

**Trace Network Issues**:
```bash
# Linux network debugging
traceroute your-server-ip
tcpdump -i any port 27015
```

## Getting Support

### Before Requesting Help

1. **Gather Information**:
   - Operating system and version
   - Cerious AASM version
   - Exact error messages
   - Steps to reproduce the issue

2. **Collect Log Files**:
   - Application logs (last 24 hours)
   - Server logs (if server-related)
   - System event logs (for crashes)

3. **Try Basic Solutions**:
   - Restart application
   - Restart server
   - Check system resources
   - Review recent changes

### Support Channels

1. **GitHub Issues**:
   - Bug reports: Provide detailed reproduction steps
   - Feature requests: Explain use case and benefits
   - Questions: Check existing issues first

2. **Documentation**:
   - Review User Manual for feature explanations
   - Check Installation Guide for setup issues

3. **Community Forums**:
   - User-to-user support
   - Share configurations and tips
   - Community troubleshooting

### Creating Effective Bug Reports

**Template**:
```
**Environment**:
- OS: Windows 10 Pro 64-bit
- Version: Cerious AASM v1.0.0
- RAM: 16GB
- Storage: SSD

**Issue Description**:
Clear description of the problem

**Steps to Reproduce**:
1. Step one
2. Step two
3. Problem occurs

**Expected Behavior**:
What should happen

**Actual Behavior**:
What actually happens

**Log Files**:
[Attach relevant log files]

**Screenshots**:
[If applicable]
```

### Emergency Procedures

**Complete System Recovery**:
1. Stop all servers
2. Backup current configuration
3. Uninstall application
4. Clean installation directories
5. Reinstall application
6. Restore server data from backups

**Data Recovery**:
- Server save files: `ARK-Servers/{server-name}/ShooterGame/Saved/`
- Configuration: `%APPDATA%/cerious-aasm/`
- Backups: Default backup directory or custom location