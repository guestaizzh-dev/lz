# Registers the standard Android ADB interface GUID for this attached phone only.
# Keeps the original WinUSB GUID and saves an exact rollback record first.
param([Parameter(Mandatory = $true)][string]$DeviceInstanceId)
$ErrorActionPreference = 'Stop'
if ($DeviceInstanceId -notmatch '^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}&MI_[0-9A-F]{2}\\') { throw 'Expected a specific USB interface instance ID.' }
$deviceInstance = $DeviceInstanceId
$parameterKey = 'HKLM:\SYSTEM\CurrentControlSet\Enum\' + $deviceInstance + '\Device Parameters'
$adbInterfaceGuid = '{F72FE0D4-CBCB-407D-8814-9ED673D0DD6B}'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$backupFile = Join-Path $workspaceRoot 'outputs/ui/connected-adb-registry-backup.json'
$resultFile = Join-Path $workspaceRoot 'outputs/ui/connected-adb-driver-repair.log'
try {
    $device = Get-PnpDevice -InstanceId $deviceInstance
    if ($device.FriendlyName -ne 'ADB Interface') { throw 'The expected phone ADB interface is no longer present.' }
    $parameters = Get-ItemProperty -LiteralPath $parameterKey
    if (-not (Test-Path -LiteralPath $backupFile)) {
        @{ instanceId = $deviceInstance; originalDeviceInterfaceGUID = $parameters.DeviceInterfaceGUID; originalDeviceInterfaceGUIDs = $parameters.DeviceInterfaceGUIDs } |
            ConvertTo-Json | Set-Content -LiteralPath $backupFile -Encoding UTF8
    }
    $interfaceGuids = @($parameters.DeviceInterfaceGUIDs) + @($parameters.DeviceInterfaceGUID) + @($adbInterfaceGuid)
    $interfaceGuids = @($interfaceGuids | Where-Object { $_ } | Select-Object -Unique)
    New-ItemProperty -LiteralPath $parameterKey -Name 'DeviceInterfaceGUIDs' -PropertyType MultiString -Value $interfaceGuids -Force | Out-Null
    & pnputil /restart-device $deviceInstance | Out-File -LiteralPath $resultFile -Encoding UTF8
    if ($LASTEXITCODE -ne 0) { throw 'Windows could not restart the specific ADB interface.' }
    'ADB GUID registered; original GUID retained.' | Add-Content -LiteralPath $resultFile -Encoding UTF8
} catch {
    $_.Exception.Message | Out-File -LiteralPath $resultFile -Encoding UTF8
    exit 1
}
