import { InvoiceDetail } from "@/components/InvoiceDetail";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InvoiceDetail invoiceId={id} />;
}
