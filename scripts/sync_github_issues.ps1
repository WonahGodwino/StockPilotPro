param(
  [string]$Repo = 'WonahGodwino/StockPilotPro',
  [string]$IssuesDoc = 'docs/GITHUB_ISSUES.md',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Get-MilestoneTitle([int]$n) {
  if (($n -ge 1 -and $n -le 25) -or ($n -ge 32 -and $n -le 40)) {
    return 'M1 - MVP Launch'
  }
  if (($n -ge 26 -and $n -le 31) -or $n -eq 33 -or $n -eq 34 -or ($n -ge 41 -and $n -le 46) -or $n -eq 51 -or $n -eq 52) {
    return 'M2 - Hardening & Reliability'
  }
  return 'M3 - Polish & Growth'
}

function Get-PhaseLabel([string]$milestoneTitle) {
  switch ($milestoneTitle) {
    'M1 - MVP Launch' { return 'mvp' }
    'M2 - Hardening & Reliability' { return 'hardening' }
    default { return 'polish' }
  }
}

function Sanitize-Body([string]$body) {
  $lines = $body -split "`r?`n"
  $safe = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    if ($line -match 'Demo credentials') { continue }
    if ($line -match '@stockpilot\.pro' -or $line -match '@demo\.com') { continue }
    if ($line -match 'SuperAdmin@|Admin@|Sales@') { continue }
    $safe.Add($line)
  }
  return ($safe -join "`n").Trim()
}

if (!(Test-Path $IssuesDoc)) {
  throw "Issues doc not found: $IssuesDoc"
}

foreach ($priorityLabel in @('p0','p1','p2','p3')) {
  gh label create $priorityLabel --repo $Repo --color 5319e7 --description 'Priority label' --force 2>$null | Out-Null
}

$content = Get-Content -Raw -Path $IssuesDoc
$pattern = '(?ms)^### Issue #(?<num>\d+)\s+—\s+(?<title>.+?)\r?\n\*\*Labels:\*\*\s+(?<labels>.+?)\r?\n\*\*Priority:\*\*\s+(?<priority>P\d)\r?\n\r?\n(?<body>.*?)(?=^---\s*$|^### Issue #|\*Total Issues:)'
$matches = [regex]::Matches($content, $pattern)

$existing = gh issue list --repo $Repo --state all --limit 500 --json title | ConvertFrom-Json
$existingTitles = @{}
foreach ($i in $existing) { $existingTitles[$i.title] = $true }

$created = 0
$skipped = 0

foreach ($m in $matches) {
  $num = [int]$m.Groups['num'].Value
  $title = $m.Groups['title'].Value.Trim()
  $labelsRaw = $m.Groups['labels'].Value
  $priority = $m.Groups['priority'].Value.Trim()
  $bodyRaw = $m.Groups['body'].Value.Trim()

  $labelMatches = [regex]::Matches($labelsRaw, '`([^`]+)`')
  $labels = @()
  foreach ($lm in $labelMatches) { $labels += $lm.Groups[1].Value }

  $milestone = Get-MilestoneTitle $num
  $phaseLabel = Get-PhaseLabel $milestone
  $labels += $phaseLabel
  if ($labels -notcontains $priority.ToLower()) { $labels += $priority.ToLower() }

  $fullTitle = "[$priority] $title"
  $safeBody = Sanitize-Body $bodyRaw
  $finalBody = "Source: docs/GITHUB_ISSUES.md (Issue #$num)`n`n$safeBody"

  if ($existingTitles.ContainsKey($fullTitle)) {
    Write-Host "SKIP existing: $fullTitle"
    $skipped++
    continue
  }

  if ($DryRun) {
    Write-Host "DRYRUN create: $fullTitle -> $milestone"
    $created++
    continue
  }

  $args = @('issue','create','--repo',$Repo,'--title',$fullTitle,'--body',$finalBody,'--milestone',$milestone)
  $tmpBodyPath = Join-Path $env:TEMP ("stockpilot_issue_{0}.md" -f [guid]::NewGuid().ToString('N'))
  Set-Content -Path $tmpBodyPath -Value $finalBody -Encoding UTF8
  $args = @('issue','create','--repo',$Repo,'--title',$fullTitle,'--body-file',$tmpBodyPath,'--milestone',$milestone)
  foreach ($l in ($labels | Select-Object -Unique)) {
    $args += @('--label',$l)
  }

  gh @args | Out-Null
  $exitCode = $LASTEXITCODE
  Remove-Item -Path $tmpBodyPath -ErrorAction SilentlyContinue
  if ($exitCode -ne 0) {
    Write-Warning "FAILED: $fullTitle"
    continue
  }

  Write-Host "CREATED: $fullTitle"
  $created++
}

# Future upgrades beyond current docs
$future = @(
  @{
    Title='[P2] Multi-currency pricing and reporting';
    Body='Add multi-currency support for products, sales, expenses, and reports with configurable base currency and FX rate snapshots per transaction.';
    Milestone='M3 - Polish & Growth';
    Labels=@('enhancement','backend','frontend','polish','p2')
  },
  @{
    Title='[P2] Scheduled database backup and restore drill automation';
    Body='Implement automated backup verification with periodic restore drills and report outcomes in an operations dashboard.';
    Milestone='M2 - Hardening & Reliability';
    Labels=@('enhancement','infra','hardening','p2')
  },
  @{
    Title='[P2] SSO support (Google/Microsoft) for admin users';
    Body='Add optional SSO authentication for BUSINESS_ADMIN and SUPER_ADMIN accounts with tenant-level enable/disable policy.';
    Milestone='M3 - Polish & Growth';
    Labels=@('enhancement','security','backend','frontend','polish','p2')
  },
  @{
    Title='[P3] Customer/loyalty module for repeat buyers';
    Body='Introduce customer profiles, purchase history, loyalty points, and targeted promotions integrated with POS checkout.';
    Milestone='M3 - Polish & Growth';
    Labels=@('enhancement','frontend','backend','polish','p3')
  },
  @{
    Title='[P2] Observability baseline (structured logs, tracing, uptime alerts)';
    Body='Add centralized structured logging, request tracing, and uptime alerting for API endpoints and background sync jobs.';
    Milestone='M2 - Hardening & Reliability';
    Labels=@('enhancement','infra','hardening','p2')
  }
)

foreach ($f in $future) {
  if ($existingTitles.ContainsKey($f.Title)) {
    Write-Host "SKIP existing future: $($f.Title)"
    continue
  }
  if ($DryRun) {
    Write-Host "DRYRUN create future: $($f.Title)"
    continue
  }
  $tmpBodyPath = Join-Path $env:TEMP ("stockpilot_issue_future_{0}.md" -f [guid]::NewGuid().ToString('N'))
  Set-Content -Path $tmpBodyPath -Value $f.Body -Encoding UTF8
  $args = @('issue','create','--repo',$Repo,'--title',$f.Title,'--body-file',$tmpBodyPath,'--milestone',$f.Milestone)
  foreach ($l in ($f.Labels | Select-Object -Unique)) {
    $args += @('--label',$l)
  }
  gh @args | Out-Null
  $exitCode = $LASTEXITCODE
  Remove-Item -Path $tmpBodyPath -ErrorAction SilentlyContinue
  if ($exitCode -ne 0) {
    Write-Warning "FAILED future: $($f.Title)"
    continue
  }
  Write-Host "CREATED future: $($f.Title)"
}

Write-Host "Done. Created: $created, Skipped: $skipped"
