# Checks that the TPT proxy answers and accepts the session token.
# Usage: $env:TPT_TOKEN = '<token>'; .\smoke-test.ps1 [-Port 7331]
param([int]$Port = 7331)

if (-not $env:TPT_TOKEN) {
  throw 'Set $env:TPT_TOKEN to the session token (TPT: Copy Session Token).'
}

try {
  $resp = Invoke-WebRequest -UseBasicParsing -Headers @{ 'X-TPT-Token' = $env:TPT_TOKEN } `
    -Uri "http://127.0.0.1:$Port/v1/models"
  Write-Host "proxy answered HTTP $($resp.StatusCode)"
  Write-Host 'OK: the proxy is up and the upstream accepted the request.'
} catch [System.Net.WebException] {
  $response = $_.Exception.Response
  if ($null -eq $response) {
    Write-Host "Nothing is listening on port $Port. Check the TPT Output Channel for the port."
  } else {
    $code = [int]$response.StatusCode
    Write-Host "proxy answered HTTP $code"
    if ($code -eq 401) {
      Write-Host 'The token is wrong or stale. Copy it again with TPT: Copy Session Token.'
    } else {
      Write-Host 'Upstream problem. Check TPT: Test Connection and the Output Channel.'
    }
  }
} catch {
  # PowerShell 7 raises HttpResponseException instead of WebException
  $code = $_.Exception.Response.StatusCode.value__
  Write-Host "proxy answered HTTP $code"
  if ($code -eq 401) {
    Write-Host 'The token is wrong or stale. Copy it again with TPT: Copy Session Token.'
  }
}
