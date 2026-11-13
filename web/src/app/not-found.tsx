import Link from "next/link";
import { headers } from "next/headers";

/**
 * The 404 page. It reads the request (headers) so it renders per request, not once at build time:
 * that way the root layout's link preview follows the host here too (Splits on NEAR on the NEAR host).
 */
export default async function NotFound() {
  await headers();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="display-face text-3xl font-bold">Page not found</h1>
      <p className="mt-3 text-muted-foreground">There is nothing at this address.</p>
      <Link className="mt-6 font-medium text-primary-text underline underline-offset-4" href="/">
        Go to the home page
      </Link>
    </main>
  );
}
