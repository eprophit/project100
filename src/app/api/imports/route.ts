import { NextResponse } from 'next/server';
import { ensureReady } from '@/lib/bootstrap';
import { importableConnectors, importUpload } from '@/lib/imports/importer';
import { forgetImport, importDir, listImports } from '@/lib/imports/store';
import { coverage } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * File imports.
 *
 * Uploads are `multipart/form-data` rather than JSON because an Apple Health
 * export is hundreds of megabytes and base64-ing it into a JSON body would add
 * a third to that for no reason.
 */

/** Refuses obviously wrong uploads before spending disk on them. */
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GiB

export async function GET() {
  await ensureReady();
  return NextResponse.json({
    imports: listImports(),
    connectors: importableConnectors(),
    directory: importDir(),
    coverage: coverage(),
  });
}

export async function POST(request: Request) {
  await ensureReady();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file in the upload.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: `${file.name} is empty.` }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `${file.name} is ${(file.size / 1e9).toFixed(1)} GB, which is past the 1 GB limit.` },
      { status: 413 },
    );
  }

  const forced = form.get('source');
  const sourceId = typeof forced === 'string' && forced ? forced : undefined;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const outcome = await importUpload(file.name, bytes, sourceId);

    // A duplicate or an unrecognised file is a normal answer, not a fault — the
    // client renders the message and the list is still worth refreshing.
    return NextResponse.json({
      outcome,
      imports: listImports(),
      coverage: coverage(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** DELETE ?id= — forgets an import. The rows it produced are left in place. */
export async function DELETE(request: Request) {
  await ensureReady();
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });

  const removed = forgetImport(id);
  if (!removed) return NextResponse.json({ error: 'No such import.' }, { status: 404 });

  return NextResponse.json({ imports: listImports(), coverage: coverage() });
}
