/**
 * Mint an API token for an agent.
 *
 *   npm run db:mint-token -- --email claude@evolutiongolf.co.uk --name Claude
 *
 * Creates the user if it does not exist, as an admin with no password: there
 * is no password to steal because there is no password to use — the account
 * exists to own a token and to put a name on what that token does.
 *
 * Prints the token once. It is not recoverable afterwards, by design.
 */

import { PrismaClient, Role } from "@prisma/client";
import { mintToken } from "../src/lib/api-tokens";

const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = arg("--email");
  const name = arg("--name") ?? "Claude";
  if (!email) throw new Error("Pass --email");

  const organisation = await prisma.organisation.findFirst({ select: { id: true, name: true } });
  if (!organisation) throw new Error("No organisation to attach a token to");

  const user = await prisma.user.upsert({
    where: { email },
    update: { isActive: true, role: Role.ADMIN },
    create: {
      organisationId: organisation.id,
      email,
      name,
      role: Role.ADMIN,
      isActive: true,
      // No usable password hash: this account is not for signing in.
      passwordHash: "",
      mustChangePassword: false,
    },
    select: { id: true, name: true },
  });

  const { token } = await mintToken(prisma, {
    userId: user.id,
    organisationId: organisation.id,
    name,
  });

  console.log(`\nOrganisation : ${organisation.name}`);
  console.log(`Acting as    : ${user.name} <${email}>`);
  console.log(`Token name   : ${name}`);
  console.log(`\n  ${token}\n`);
  console.log("Shown once. Store it as a secret; it cannot be read back.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
