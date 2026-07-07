```yaml
run_id: FA-1a6e663-1a6e663-5746f13dedbb
base_sha: 1a6e663a8ea172330eabb1ef7ab891a304595709
head_sha: 1a6e663a8ea172330eabb1ef7ab891a304595709
manifest_digest: 5746f13dedbb
approved_finding_ids:
  - FA-1a6e663-1a6e663-5746f13dedbb-M1   # SponsorProtocolDrawer overlay-hook parity (medium)
approved_by: sixonelabs-piqc (founder), via interactive approval 2026-07-07
approved_at: 2026-07-07
scope_exceptions: []
```

Decision context: full-surface sponsor audit (Sponsor Ask #464 focus). 2 candidates → 1 confirmed
(this), 1 refuted (guardedSetMessages race — disproven by execution-order trace), 0 needs-human.
"Apply" selected. Single batch, single file, xs: wire SponsorProtocolDrawer onto
useOverlay + useSwipeDismiss (same fix shape as site's ProtocolDetailDrawer in #469; hook already
stack-aware per #468). Branch: fable-apply/FA-1a6e663-sponsor-drawer · owner @fable-dev-piqc.
