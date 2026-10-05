import { existsSync, readFileSync } from "node:fs"

const failures = []

function read(path) {
  if (!existsSync(path)) {
    failures.push(`missing required file: ${path}`)
    return ""
  }
  return readFileSync(path, "utf8")
}

const REQUIRED_VARIANTS = [
  "data-open",
  "data-closed",
  "data-checked",
  "data-unchecked",
  "data-disabled",
  "data-active",
  "data-horizontal",
  "data-vertical",
]

// package.json must not declare shadcn as a direct dependency
try {
  const pkg = JSON.parse(read("package.json"))
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (pkg[section] && Object.prototype.hasOwnProperty.call(pkg[section], "shadcn")) {
      failures.push(`package.json ${section} must not contain direct shadcn dependency`)
    }
  }
} catch {
  /* read() already recorded missing file; avoid double JSON error noise */
}

// package-lock.json must not declare shadcn as a root package dependency
try {
  const lock = JSON.parse(read("package-lock.json"))
  const rootDeps = {
    ...(lock.packages?.[""]?.dependencies ?? {}),
    ...(lock.packages?.[""]?.devDependencies ?? {}),
  }
  if (Object.prototype.hasOwnProperty.call(rootDeps, "shadcn")) {
    failures.push("package-lock.json root packages[''] must not depend on shadcn")
  }
  if (lock.packages?.[""]?.name === "shadcn") {
    failures.push("package-lock.json root must not be shadcn")
  }
} catch {
  /* ignore parse errors already covered */
}

// src/index.css must not import shadcn/tailwind.css
const indexCss = read("src/index.css")
if (indexCss.includes('shadcn/tailwind.css') || indexCss.includes('from "shadcn') || indexCss.includes("from 'shadcn")) {
  failures.push('src/index.css must not import "shadcn/tailwind.css"')
}
if (!indexCss.includes("./styles/shadcn-variants.css")) {
  failures.push("src/index.css must import ./styles/shadcn-variants.css")
}

// local variants file must exist and declare every required custom variant
const variants = read("src/styles/shadcn-variants.css")
for (const name of REQUIRED_VARIANTS) {
  if (!variants.includes(`@custom-variant ${name}`)) {
    failures.push(`src/styles/shadcn-variants.css missing @custom-variant ${name}`)
  }
}
for (const banned of ["scroll-fade", "shimmer", "accordion-down", "data-selected"]) {
  if (variants.includes(banned)) {
    failures.push(`src/styles/shadcn-variants.css must not include unused upstream block: ${banned}`)
  }
}

// third-party notice must exist and cite shadcn MIT
const notices = read("THIRD_PARTY_NOTICES.md")
if (!notices.includes("shadcn")) failures.push("THIRD_PARTY_NOTICES.md must mention shadcn")
if (!notices.includes("MIT License")) failures.push("THIRD_PARTY_NOTICES.md must include MIT License")
if (!notices.includes("Copyright (c) 2023 shadcn")) {
  failures.push("THIRD_PARTY_NOTICES.md must include Copyright (c) 2023 shadcn")
}
if (!notices.includes("https://github.com/shadcn-ui/ui")) {
  failures.push("THIRD_PARTY_NOTICES.md must link upstream https://github.com/shadcn-ui/ui")
}
if (!notices.includes("shadcn@4.21.1")) {
  failures.push("THIRD_PARTY_NOTICES.md must record package version source shadcn@4.21.1")
}

// README must link the notice file
const readme = read("README.md")
if (!readme.includes("THIRD_PARTY_NOTICES.md")) {
  failures.push("README.md must link THIRD_PARTY_NOTICES.md")
}

if (failures.length) {
  throw new Error(`shadcn removal gate failed:\n${failures.join("\n")}`)
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      directShadcnDependency: false,
      indexCssImport: "./styles/shadcn-variants.css",
      requiredVariants: REQUIRED_VARIANTS,
      notices: "THIRD_PARTY_NOTICES.md",
      versionSource: "shadcn@4.21.1",
    },
    null,
    2,
  ),
)
