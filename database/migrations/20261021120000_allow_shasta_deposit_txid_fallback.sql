BEGIN;

-- Shasta-only TXID fallback: preserve any user-supplied value for audit, but
-- leave the canonical txid NULL until the server finds and validates the actual
-- confirmed on-chain transaction. Mainnet submissions still require a valid TXID.
ALTER TABLE public.deposit_submissions
  ALTER COLUMN txid DROP NOT NULL;

ALTER TABLE public.deposit_submissions
  ADD COLUMN IF NOT EXISTS submitted_txid text;

UPDATE public.deposit_submissions
   SET submitted_txid = txid
 WHERE submitted_txid IS NULL
   AND NULLIF(btrim(txid), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deposit_submissions_network_submitted_txid
  ON public.deposit_submissions (lower(btrim(network)), lower(btrim(submitted_txid)))
  WHERE NULLIF(btrim(submitted_txid), '') IS NOT NULL
    AND NULLIF(btrim(network), '') IS NOT NULL;

COMMENT ON COLUMN public.deposit_submissions.txid IS
  'Canonical transaction ID confirmed by server-side on-chain verification; NULL for Shasta requests until a unique confirmed transfer is matched.';
COMMENT ON COLUMN public.deposit_submissions.submitted_txid IS
  'Untrusted TXID entered by the user; may be missing or mistyped and must never be used by itself to credit funds.';

COMMIT;
