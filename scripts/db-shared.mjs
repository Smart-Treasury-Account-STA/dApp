// Shared bits of the two database scripts.
export const MIGRATIONS_FOLDER = './src/lib/db/migrations'

export function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      'DATABASE_URL must be set. For a Neon branch:\n' +
        '  DATABASE_URL="$(neon connection-string <branch> --project-id <id> \\\n' +
        '    --database-name <db> --role-name <role>)" pnpm db:migrate'
    )
    process.exit(1)
  }
  return url
}
