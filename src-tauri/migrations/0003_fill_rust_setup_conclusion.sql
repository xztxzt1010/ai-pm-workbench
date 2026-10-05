UPDATE confirmation_items
SET conclusion = 'Rust/Cargo 1.97.0 stable（MSVC toolchain）已安装并通过原生构建验证。',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'confirmation-rust'
  AND (conclusion IS NULL OR TRIM(conclusion) = '');
