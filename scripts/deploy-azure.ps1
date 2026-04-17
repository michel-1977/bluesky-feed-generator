[CmdletBinding()]
param(
  [string]$SubscriptionId = 'adc02409-5286-47fe-9db3-e6073c0860d4',
  [string]$ResourceGroup = 'rg-bluesky-feed',
  [string]$ContainerAppName = 'app-bluesky-feed',
  [string]$RegistryName = 'ca7300480f77acr',
  [string]$ImageRepository = 'app-bluesky-feed',
  [string]$ExpectedStorageShare = 'feeddb',
  [string]$WorkingDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $WorkingDirectory) {
  $WorkingDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Invoke-AzJson {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $output = & az @Arguments --only-show-errors --output json
  if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI command failed: az $($Arguments -join ' ')"
  }

  if ([string]::IsNullOrWhiteSpace($output)) {
    return $null
  }

  return $output | ConvertFrom-Json
}

function Invoke-AzTsv {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $output = & az @Arguments --only-show-errors --output tsv
  if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI command failed: az $($Arguments -join ' ')"
  }

  return [string]$output
}

function Get-RequiredEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$EnvVars,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  foreach ($envVar in $EnvVars) {
    if ($envVar.name -eq $Name -and $envVar.value) {
      return [string]$envVar.value
    }
  }

  throw "Container app is missing required env var '$Name'."
}

function Wait-ForFileCopy {
  param(
    [Parameter(Mandatory = $true)]
    [string]$StorageAccountName,
    [Parameter(Mandatory = $true)]
    [string]$StorageAccountKey,
    [Parameter(Mandatory = $true)]
    [string]$ShareName,
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $deadline = (Get-Date).AddMinutes(2)
  while ((Get-Date) -lt $deadline) {
    try {
      $file = Invoke-AzJson -Arguments @(
        'storage', 'file', 'show',
        '--account-name', $StorageAccountName,
        '--account-key', $StorageAccountKey,
        '--share-name', $ShareName,
        '--path', $Path
      )

      $copyStatus = [string]$file.properties.copy.status
      if (-not $copyStatus -or $copyStatus -eq 'success') {
        if ([int64]$file.properties.contentLength -gt 0) {
          return $file
        }
      }
    } catch {
    }

    Start-Sleep -Seconds 5
  }

  throw "Timed out waiting for Azure Files backup '$Path' to complete."
}

function Wait-ForContainerAppRevision {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroup,
    [Parameter(Mandatory = $true)]
    [string]$ContainerAppName,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedImage
  )

  $deadline = (Get-Date).AddMinutes(10)
  while ((Get-Date) -lt $deadline) {
    $app = Invoke-AzJson -Arguments @(
      'containerapp', 'show',
      '-g', $ResourceGroup,
      '-n', $ContainerAppName
    )

    $container = $app.properties.template.containers[0]
    $latestRevision = [string]$app.properties.latestRevisionName
    $latestReadyRevision = [string]$app.properties.latestReadyRevisionName
    $runningStatus = [string]$app.properties.runningStatus
    $image = [string]$container.image

    Write-Host "Waiting for revision '$latestRevision' (ready '$latestReadyRevision', status '$runningStatus')."

    if (
      $latestRevision -and
      $latestRevision -eq $latestReadyRevision -and
      $runningStatus -eq 'Running' -and
      $image -eq $ExpectedImage
    ) {
      return $app
    }

    Start-Sleep -Seconds 10
  }

  throw "Timed out waiting for container app '$ContainerAppName' to become healthy on image '$ExpectedImage'."
}

$account = Invoke-AzJson -Arguments @('account', 'show')
if (-not $account) {
  throw 'Azure CLI is not logged in.'
}

if ([string]$account.id -ne $SubscriptionId) {
  Write-Host "Switching Azure subscription to $SubscriptionId."
  & az account set --subscription $SubscriptionId --only-show-errors
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to set Azure subscription to '$SubscriptionId'."
  }
}

$app = Invoke-AzJson -Arguments @(
  'containerapp', 'show',
  '-g', $ResourceGroup,
  '-n', $ContainerAppName
)

if (-not $app) {
  throw "Container app '$ContainerAppName' was not found in resource group '$ResourceGroup'."
}

$container = $app.properties.template.containers[0]
$currentImage = [string]$container.image
$containerName = [string]$container.name
$fqdn = [string]$app.properties.configuration.ingress.fqdn
$revisionsMode = [string]$app.properties.configuration.activeRevisionsMode
$scale = $app.properties.template.scale

if ($revisionsMode -ne 'Single') {
  Write-Host "Container app is currently in '$revisionsMode' revision mode; the deployment will force 'Single'."
}

if ([int]$scale.minReplicas -ne 1 -or [int]$scale.maxReplicas -ne 1) {
  Write-Host "Container app replicas are min=$($scale.minReplicas) max=$($scale.maxReplicas); the deployment will enforce min=1 and max=1."
}

$envVars = @($container.env)
$publisherDid = Get-RequiredEnvValue -EnvVars $envVars -Name 'FEEDGEN_PUBLISHER_DID'
$feedShortname = Get-RequiredEnvValue -EnvVars $envVars -Name 'FEEDGEN_FEED_SHORTNAME'
$backupLocation = Get-RequiredEnvValue -EnvVars $envVars -Name 'FEEDGEN_SQLITE_BACKUP_LOCATION'

$volumeMount = $container.volumeMounts | Select-Object -First 1
if (-not $volumeMount) {
  throw 'Container app has no volume mount configured. Refusing to deploy without persistent history storage.'
}

$volume = $app.properties.template.volumes | Where-Object { $_.name -eq $volumeMount.volumeName } | Select-Object -First 1
if (-not $volume) {
  throw "Container app volume '$($volumeMount.volumeName)' could not be resolved."
}

$environmentName = ($app.properties.environmentId -split '/')[-1]
$storage = Invoke-AzJson -Arguments @(
  'containerapp', 'env', 'storage', 'show',
  '-g', $ResourceGroup,
  '-n', $environmentName,
  '--storage-name', [string]$volume.storageName
)

$storageAccountName = [string]$storage.properties.azureFile.accountName
$shareName = [string]$storage.properties.azureFile.shareName
if ($shareName -ne $ExpectedStorageShare) {
  throw "Resolved Azure Files share '$shareName' does not match expected '$ExpectedStorageShare'."
}

$mountPath = ([string]$volumeMount.mountPath).TrimEnd('/')
$sqliteRelativePath = $backupLocation
if ($sqliteRelativePath.StartsWith($mountPath)) {
  $sqliteRelativePath = $sqliteRelativePath.Substring($mountPath.Length).TrimStart('/')
}

if (-not $sqliteRelativePath) {
  throw "Unable to derive Azure Files path from FEEDGEN_SQLITE_BACKUP_LOCATION '$backupLocation'."
}

$storageAccountKey = Invoke-AzTsv -Arguments @(
  'storage', 'account', 'keys', 'list',
  '-g', $ResourceGroup,
  '-n', $storageAccountName,
  '--query', '[0].value'
)

if (-not $storageAccountKey) {
  throw "Unable to read an access key for storage account '$storageAccountName'."
}

$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
$gitShortSha = 'nogit'
try {
  $gitShortSha = ((git -C $WorkingDirectory rev-parse --short HEAD) | Select-Object -First 1).Trim()
  if (-not $gitShortSha) {
    $gitShortSha = 'nogit'
  }
} catch {
}

$backupDirectory = 'backups'
$backupFileName = "db-$timestamp.sqlite"
$backupPath = "$backupDirectory/$backupFileName"

Write-Host "Creating Azure Files backup '$backupPath' from '$sqliteRelativePath'."
& az storage directory create `
  --account-name $storageAccountName `
  --account-key $storageAccountKey `
  --share-name $shareName `
  --name $backupDirectory `
  --only-show-errors `
  --output none
if ($LASTEXITCODE -ne 0) {
  throw "Unable to create Azure Files directory '$backupDirectory'."
}

& az storage file copy start `
  --source-account-name $storageAccountName `
  --source-account-key $storageAccountKey `
  --source-share $shareName `
  --source-path $sqliteRelativePath `
  --destination-share $shareName `
  --destination-path $backupPath `
  --account-name $storageAccountName `
  --account-key $storageAccountKey `
  --only-show-errors `
  --output none
if ($LASTEXITCODE -ne 0) {
  throw "Unable to start Azure Files backup copy for '$sqliteRelativePath'."
}

$backupFile = Wait-ForFileCopy `
  -StorageAccountName $storageAccountName `
  -StorageAccountKey $storageAccountKey `
  -ShareName $shareName `
  -Path $backupPath

Write-Host "Azure Files backup completed with size $($backupFile.properties.contentLength) bytes."

$loginServer = Invoke-AzTsv -Arguments @(
  'acr', 'show',
  '-n', $RegistryName,
  '--query', 'loginServer'
)
if (-not $loginServer) {
  throw "Unable to resolve login server for registry '$RegistryName'."
}

$imageTag = "release-$gitShortSha-$timestamp"
$newImage = "$loginServer/${ImageRepository}:$imageTag"

Write-Host "Building image '$newImage' with ACR."
Push-Location $WorkingDirectory
try {
  & az acr build `
    -r $RegistryName `
    -t "${ImageRepository}:$imageTag" `
    --only-show-errors `
    $WorkingDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "ACR build failed for '$newImage'."
  }
} finally {
  Pop-Location
}

Write-Host "Updating container app '$ContainerAppName' to image '$newImage'."
& az containerapp update `
  -g $ResourceGroup `
  -n $ContainerAppName `
  --container-name $containerName `
  --image $newImage `
  --revisions-mode single `
  --min-replicas 1 `
  --max-replicas 1 `
  --termination-grace-period 60 `
  --only-show-errors `
  --output none
if ($LASTEXITCODE -ne 0) {
  throw "Container app update failed for '$ContainerAppName'."
}

$updatedApp = Wait-ForContainerAppRevision `
  -ResourceGroup $ResourceGroup `
  -ContainerAppName $ContainerAppName `
  -ExpectedImage $newImage

$metricsUrl = "https://$fqdn/metrics"
$feedUri = "at://$publisherDid/app.bsky.feed.generator/$feedShortname"
$encodedFeedUri = [System.Uri]::EscapeDataString($feedUri)
$feedUrl = "https://$fqdn/xrpc/app.bsky.feed.getFeedSkeleton?feed=$encodedFeedUri&limit=5"

Write-Host "Smoke testing $metricsUrl"
$metricsResponse = Invoke-WebRequest -UseBasicParsing -Uri $metricsUrl
if ([int]$metricsResponse.StatusCode -ne 200) {
  throw "Smoke test failed for '$metricsUrl' with status code $($metricsResponse.StatusCode)."
}

Write-Host "Smoke testing $feedUrl"
$feedResponse = Invoke-WebRequest -UseBasicParsing -Uri $feedUrl
if ([int]$feedResponse.StatusCode -ne 200) {
  throw "Smoke test failed for '$feedUrl' with status code $($feedResponse.StatusCode)."
}

$feedJson = $feedResponse.Content | ConvertFrom-Json
$firstPost = $null
if ($feedJson.feed -and $feedJson.feed.Count -gt 0) {
  $firstPost = [string]$feedJson.feed[0].post
}

Write-Host ''
Write-Host 'Deployment complete.'
Write-Host "Current image:  $newImage"
Write-Host "Previous image: $currentImage"
Write-Host "SQLite backup:  $shareName/$backupPath"
Write-Host "Revision:       $($updatedApp.properties.latestReadyRevisionName)"
Write-Host "Metrics URL:    $metricsUrl"
Write-Host "Feed URL:       $feedUrl"
if ($firstPost) {
  Write-Host "First feed post: $firstPost"
}
Write-Host "Rollback command: az containerapp update -g $ResourceGroup -n $ContainerAppName --container-name $containerName --image $currentImage --revisions-mode single --min-replicas 1 --max-replicas 1 --termination-grace-period 60"
