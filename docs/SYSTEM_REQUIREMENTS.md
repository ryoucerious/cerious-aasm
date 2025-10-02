# System Requirements - Cerious AASM

## Table of Contents
1. [Minimum Requirements](#minimum-requirements)
2. [Recommended Specifications](#recommended-specifications)
3. [Platform Support](#platform-support)
4. [Hardware Requirements](#hardware-requirements)
5. [Software Dependencies](#software-dependencies)
6. [Network Requirements](#network-requirements)
7. [Storage Requirements](#storage-requirements)
8. [Performance Scaling](#performance-scaling)
9. [Enterprise Requirements](#enterprise-requirements)
10. [Compatibility Notes](#compatibility-notes)

## Minimum Requirements

### System Specifications
| Component | Minimum Requirement |
|-----------|-------------------|
| **Operating System** | Windows 10 64-bit (v1903+) or Ubuntu 18.04+ |
| **Processor** | Intel Core i3-4000 series / AMD FX-6000 series |
| **Memory** | 4 GB RAM |
| **Storage** | 50 GB available space (SSD recommended) |
| **Network** | Broadband Internet connection |
| **Graphics** | DirectX 11 compatible (for GUI mode) |

### For Single ARK Server
- **CPU**: 2 cores, 2.5 GHz minimum
- **RAM**: 4 GB system + 2 GB for ARK server
- **Storage**: 25 GB for ARK server files + 10 GB for application
- **Network**: 5 Mbps upload (10 players), 1 Mbps per additional 5 players

## Recommended Specifications

### Optimal Performance
| Component | Recommended Specification |
|-----------|-------------------------|
| **Operating System** | Windows 11 64-bit or Ubuntu 22.04 LTS |
| **Processor** | Intel Core i5-8400 / AMD Ryzen 5 2600 |
| **Memory** | 16 GB RAM |
| **Storage** | 100 GB SSD (NVMe preferred) |
| **Network** | Dedicated server connection (100+ Mbps) |
| **Graphics** | Integrated graphics sufficient for GUI |

### For Multiple ARK Servers (2-4 servers)
- **CPU**: 6+ cores, 3.0+ GHz (Intel i7/Ryzen 7)
- **RAM**: 24-32 GB (8 GB per server + 8 GB for system)
- **Storage**: 200+ GB SSD
- **Network**: 20+ Mbps upload bandwidth

### High-Performance Setup (5+ servers)
- **CPU**: 8+ cores, 3.5+ GHz (Intel i9/Ryzen 9)
- **RAM**: 48+ GB (8-12 GB per server)
- **Storage**: 500+ GB NVMe SSD
- **Network**: Dedicated server connection (1 Gbps)

## Platform Support

### Windows
| Version | Support Status | Notes |
|---------|----------------|-------|
| Windows 11 | ✅ Fully Supported | Recommended platform |
| Windows 10 (v1903+) | ✅ Fully Supported | Minimum version required |
| Windows 10 (older) | ⚠️ Limited Support | May have compatibility issues |
| Windows 8.1 | ❌ Not Supported | End of life |
| Windows Server 2019+ | ✅ Supported | For enterprise deployments |
| Windows Server 2016 | ⚠️ Limited Support | Basic functionality only |

### Linux
| Distribution | Support Status | Notes |
|-------------|----------------|-------|
| Ubuntu 22.04 LTS | ✅ Fully Supported | Recommended Linux distribution |
| Ubuntu 20.04 LTS | ✅ Fully Supported | Well tested |
| Ubuntu 18.04 LTS | ✅ Supported | Minimum version |
| Debian 11+ | ✅ Supported | Community tested |
| CentOS 8+ | ✅ Supported | Enterprise deployments |
| RHEL 8+ | ✅ Supported | Enterprise deployments |
| Arch Linux | ⚠️ Community Support | Advanced users only |
| Fedora 35+ | ⚠️ Community Support | Recent versions only |

### Unsupported Platforms
- macOS (not supported by ARK Dedicated Server)
- Windows 7/8 (security and compatibility issues)
- 32-bit operating systems
- Windows RT/ARM versions

## Hardware Requirements

### Processor (CPU)
**Minimum**: 2 cores, 2.5 GHz
- Intel: Core i3-4000 series or newer
- AMD: FX-6000 series or newer

**Recommended**: 4+ cores, 3.0+ GHz
- Intel: Core i5-8400 or newer
- AMD: Ryzen 5 2600 or newer

**Enterprise**: 8+ cores, 3.5+ GHz
- Intel: Core i7-9700K, i9-9900K, or newer
- AMD: Ryzen 7 3700X, Ryzen 9 3900X, or newer

### Memory (RAM)
**Allocation Guide**:
- **System Overhead**: 2-4 GB for operating system
- **Application**: 1-2 GB for Cerious AASM
- **Per ARK Server**: 4-8 GB (depends on player count and mods)

**Player Count to RAM Mapping**:
| Players | RAM per Server | Example Total (1 server) |
|---------|----------------|--------------------------|
| 1-10 | 4 GB | 8 GB system total |
| 11-25 | 6 GB | 12 GB system total |
| 26-50 | 8 GB | 16 GB system total |
| 51-70 | 10 GB | 20 GB system total |
| 70+ | 12+ GB | 24+ GB system total |

### Storage
**Type Requirements**:
- **SSD Strongly Recommended**: ARK servers benefit greatly from fast I/O
- **HDD Acceptable**: For backup storage and less critical data
- **NVMe SSD Optimal**: For high-performance setups

**Space Allocation**:
- **Base Application**: 2 GB
- **SteamCMD**: 1 GB
- **ARK Server**: 25-30 GB (base game + maps)
- **Mods**: 1-10 GB per server (depending on mod selection)
- **Save Data**: 100 MB - 2 GB per server (grows over time)
- **Backups**: Plan for 2-5x server size for backup storage

**Example Storage Planning**:
```
Single Server Setup (50 GB minimum):
├── System & Applications: 10 GB
├── ARK Server Files: 25 GB
├── Save Data & Logs: 5 GB
└── Backup Storage: 10 GB

Multiple Server Setup (200 GB recommended):
├── System & Applications: 20 GB
├── ARK Server Files (3 servers): 75 GB
├── Shared Mod Storage: 15 GB
├── Save Data & Logs: 15 GB
└── Backup Storage: 75 GB
```

### Graphics
**GUI Mode**: 
- DirectX 11 compatible graphics
- Integrated graphics sufficient
- No dedicated GPU required

**Headless Mode**:
- No graphics requirements
- Can run on servers without GPUs

## Software Dependencies

### Windows Dependencies
**Automatically Installed**:
- Visual C++ Redistributable 2015-2022
- .NET Framework 4.8+
- DirectX Runtime

**Manual Installation May Be Required**:
- Windows Updates (latest cumulative update)
- PowerShell 5.1+ (for firewall management)

### Linux Dependencies
**Ubuntu/Debian**:
```bash
# Required packages
sudo apt update
sudo apt install -y curl wget ca-certificates gnupg lsb-release

# For GUI mode
sudo apt install -y libgtk-3-0 libgconf-2-4 libnss3 libxss1 libasound2

# For AppImage
sudo apt install -y fuse
```

**CentOS/RHEL**:
```bash
# Required packages
sudo yum install -y curl wget ca-certificates

# For GUI mode
sudo yum install -y gtk3 nss alsa-lib
```

### Runtime Requirements
- **Steam Account**: Not required (uses anonymous login)
- **ARK Ownership**: Not required on server machine
- **Internet Connection**: Required for initial setup and updates
- **Administrative Privileges**: Required for installation and firewall setup

## Network Requirements

### Bandwidth Guidelines
**Per Server Bandwidth Usage**:
| Players | Upload Required | Download Required |
|---------|----------------|-------------------|
| 1-10 | 2-5 Mbps | 1-2 Mbps |
| 11-25 | 5-10 Mbps | 2-3 Mbps |
| 26-50 | 10-20 Mbps | 3-5 Mbps |
| 51-70 | 20-35 Mbps | 5-8 Mbps |

### Port Requirements
**Required Ports (per server)**:
- **Game Port**: 27015 (TCP) - Player connections
- **Query Port**: 27016 (UDP) - Server browser queries
- **RCON Port**: 27020 (TCP) - Remote administration

**Optional Ports**:
- **Web Interface**: 3000 (TCP) - Default web UI port
- **Steam Master**: 27017 (UDP) - Steam server listing

**Port Calculation**:
```
Server 1: Game 27015, Query 27016, RCON 27020
Server 2: Game 27025, Query 27026, RCON 27030
Server 3: Game 27035, Query 27036, RCON 27040
(+10 for each additional server)
```

### Firewall Configuration
**Inbound Rules Required**:
- Allow configured game ports (TCP)
- Allow configured query ports (UDP)
- Allow RCON ports (TCP) - if using remote admin
- Allow web interface port (TCP) - if using web UI

**Outbound Rules Required**:
- Allow Steam content servers (Port 443, 80)
- Allow Steam master servers
- Allow NTP for time sync (Port 123)

## Storage Requirements

### Disk I/O Performance
**Minimum I/O Requirements**:
- **Sequential Read**: 100 MB/s
- **Sequential Write**: 50 MB/s
- **Random Read IOPS**: 500 IOPS
- **Random Write IOPS**: 250 IOPS

**Recommended I/O Performance**:
- **Sequential Read**: 500+ MB/s
- **Sequential Write**: 300+ MB/s
- **Random Read IOPS**: 2000+ IOPS
- **Random Write IOPS**: 1000+ IOPS

### File System Requirements
**Windows**:
- NTFS file system required
- ExFAT not supported for server files
- ReFS supported on Windows Server

**Linux**:
- ext4 recommended (most tested)
- XFS supported (good for large files)
- Btrfs supported (advanced users)
- ZFS supported (advanced users with sufficient RAM)

### Backup Storage Planning
**Backup Strategy Considerations**:
- **Local Backups**: Same disk performance requirements
- **Network Backups**: Network bandwidth becomes limiting factor
- **Cloud Backups**: Internet upload speed limits
- **Archive Storage**: Can use slower, cheaper storage

## Performance Scaling

### Single Server Performance
**Player Count vs Requirements**:
```
10 Players:  2 cores, 4GB RAM, 5 Mbps up
25 Players:  4 cores, 6GB RAM, 10 Mbps up
50 Players:  4 cores, 8GB RAM, 20 Mbps up
70 Players:  6 cores, 10GB RAM, 35 Mbps up
```

### Multiple Server Scaling
**Scaling Considerations**:
- CPU cores scale linearly with server count
- RAM requirements are additive per server
- Network bandwidth is additive per server
- Disk I/O becomes shared resource (SSD critical)

**Example Multi-Server Configurations**:
```
3 Servers (25 players each):
├── CPU: 8 cores, 3.0+ GHz
├── RAM: 24 GB (6GB × 3 servers + 6GB system)
├── Storage: 100 GB SSD
└── Network: 30 Mbps upload

5 Servers (50 players each):
├── CPU: 12 cores, 3.5+ GHz
├── RAM: 48 GB (8GB × 5 servers + 8GB system)
├── Storage: 200 GB NVMe SSD
└── Network: 100 Mbps upload
```

## Enterprise Requirements

### Production Environment
**High Availability Setup**:
- **Primary Server**: Main application instance
- **Backup Server**: Hot standby for failover
- **Load Balancer**: Distribute web interface access
- **Shared Storage**: Network-attached storage for server files

**Monitoring Requirements**:
- **System Monitoring**: CPU, RAM, disk, network usage
- **Application Monitoring**: Server status, player counts
- **Log Aggregation**: Centralized logging solution
- **Alerting**: Automated notifications for issues

### Virtualization Support
**VMware vSphere**:
- ✅ Fully supported
- Minimum 2 vCPU, 8 GB vRAM
- SSD-backed storage required

**Hyper-V**:
- ✅ Supported
- Generation 2 VMs recommended
- Dynamic memory supported

**Container Support**:
- ⚠️ Limited support
- Docker containers possible but complex
- Kubernetes deployment possible

### Cloud Deployment
**AWS EC2 Recommended Instances**:
- **Single Server**: t3.large (2 vCPU, 8 GB RAM)
- **Multiple Servers**: c5.2xlarge (8 vCPU, 16 GB RAM)
- **High Performance**: c5.4xlarge (16 vCPU, 32 GB RAM)

**Azure Virtual Machines**:
- **Single Server**: Standard_D2s_v3
- **Multiple Servers**: Standard_D4s_v3
- **High Performance**: Standard_D8s_v3

**Google Cloud Platform**:
- **Single Server**: n2-standard-2
- **Multiple Servers**: n2-standard-4
- **High Performance**: n2-standard-8

## Compatibility Notes

### Known Issues
**Windows Specific**:
- Windows Defender may flag steamcmd.exe (false positive)
- Some antivirus software interferes with server files
- Windows N editions may require Media Feature Pack

**Linux Specific**:
- Some distributions require additional library packages
- SELinux may block network operations (can be configured)
- Wayland display server has limited support (X11 recommended)

### Version Compatibility
**ARK Server Compatibility**:
- Supports all official ARK server versions
- Automatic updates when new ARK versions release
- Backward compatibility with existing save files

**Operating System Updates**:
- Windows feature updates fully supported
- Linux kernel updates generally compatible
- Major OS upgrades may require application update

### Hardware Compatibility
**CPU Architecture**:
- x86_64 (64-bit) required
- ARM processors not supported
- Virtual CPU environments supported

**Storage Interfaces**:
- SATA SSDs/HDDs supported
- NVMe drives supported and recommended
- Network storage (NFS, SMB) supported with performance caveats
- USB external drives not recommended for server files

### Performance Optimization Tips
1. **Use SSD storage** for significant performance improvement
2. **Allocate sufficient RAM** to avoid swapping
3. **Monitor CPU usage** and upgrade if consistently over 80%
4. **Regular maintenance** including disk defragmentation (HDD only)
5. **Network optimization** through QoS rules if possible
6. **Firewall tuning** to minimize latency
7. **Regular backups** to prevent data loss
8. **Update management** to ensure security and performance