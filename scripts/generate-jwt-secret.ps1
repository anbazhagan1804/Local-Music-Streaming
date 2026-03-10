param(
  [int]$Length = 64
)

$bytes = New-Object byte[] $Length
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
Write-Output $secret
