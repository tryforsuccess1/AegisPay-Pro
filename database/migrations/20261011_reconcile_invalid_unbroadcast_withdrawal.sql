-- Master Admin-confirmed reconciliation for an approved withdrawal with an invalid
-- Base58Check destination, but only when the payout has definitely not started/broadcast.
CREATE OR REPLACE FUNCTION public.reconcile_invalid_unbroadcast_withdrawal(
 p_request_id uuid, p_admin_user_id uuid, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 w public.withdrawal_requests; u public.users; a public.users; v_reason text:=left(trim(COALESCE(p_reason,'')),500);
BEGIN
 IF p_admin_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Master Admin identity is required'; END IF;
 SELECT * INTO a FROM public.users WHERE id=p_admin_user_id FOR SHARE;
 IF a.id IS NULL OR a.role<>'MASTER ADMIN' OR upper(COALESCE(a.status,'')) NOT IN ('ACTIVE','NORMAL') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active Master Admin access is required';
 END IF;
 IF length(v_reason)<10 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Enter a clear reconciliation reason of at least 10 characters'; END IF;
 SELECT * INTO w FROM public.withdrawal_requests WHERE id=p_request_id FOR UPDATE;
 IF w.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Withdrawal request not found'; END IF;
 IF w.status<>'APPROVED' OR w.panel_decision<>'APPROVED' OR w.telegram_decision<>'APPROVED' THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Only a fully approved withdrawal can use this reconciliation workflow';
 END IF;
 IF w.payout_txid IS NOT NULL OR w.payout_started_at IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='This payout may have been broadcast. Do not refund automatically; perform a chain reconciliation first';
 END IF;
 IF w.balance_deducted IS NOT TRUE THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='The balance-deduction state is not confirmed. Manual financial reconciliation is required';
 END IF;
 IF public.is_valid_tron_address(trim(COALESCE(w.destination_address,''))) THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='The stored destination is valid. This invalid-wallet refund workflow does not apply';
 END IF;
 SELECT * INTO u FROM public.users WHERE id=w.user_id FOR UPDATE;
 IF u.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Client account not found'; END IF;
 UPDATE public.users SET current_platform_balance=round(COALESCE(current_platform_balance,0)+w.amount,2) WHERE id=u.id;
 UPDATE public.withdrawal_requests
 SET status='FAILED',balance_deducted=false,
     payout_error=left('Cancelled before broadcast and gross balance restored because the stored TRON destination failed Base58Check. Reason: '||v_reason,500),
     ai_decision='MANUAL_REVIEW',
     ai_review_reason=left('Master Admin cancelled and refunded an unbroadcast request with an invalid exact-case TRON destination. Reason: '||v_reason,500),
     ai_reviewed_at=now()
 WHERE id=w.id AND status='APPROVED' AND payout_txid IS NULL AND payout_started_at IS NULL AND balance_deducted=true;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Withdrawal state changed during reconciliation. No refund was committed'; END IF;
 INSERT INTO public.account_ledger(user_id,actor_user_id,entry_type,amount,description,reference_id,metadata)
 VALUES(u.id,a.id,'WITHDRAWAL_REFUND',w.amount,'Gross withdrawal amount restored after Master Admin cancelled invalid unbroadcast TRON withdrawal',
   w.id::text,jsonb_build_object('withdrawal_id',w.id,'reason',v_reason,'payout_txid',NULL,'payout_started_at',NULL));
 INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
 VALUES(u.id,'withdrawal_reconciled','Withdrawal cancelled and balance restored',
   'Your approved withdrawal could not be sent because the saved TRON wallet address was invalid. The gross amount of '||
   to_char(w.amount,'FM999999990.00')||' USDT has been restored to your available platform balance. Please confirm the exact wallet address with Master Admin and submit a new request.',false);
 INSERT INTO public.audit_events(actor_user_id,target_user_id,event_type,description,reference_id)
 VALUES(a.id,u.id,'WITHDRAWAL_INVALID_WALLET_REFUNDED',
   'Master Admin cancelled an approved but unbroadcast withdrawal with an invalid exact-case TRON Base58Check address; gross amount restored. Reason='||v_reason,w.id::text);
 RETURN jsonb_build_object('ok',true,'status','FAILED','withdrawal_id',w.id,'refund_amount',w.amount,'client_user_id',u.id,'reason',v_reason,'new_status','FAILED');
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_invalid_unbroadcast_withdrawal(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_invalid_unbroadcast_withdrawal(uuid,uuid,text) TO service_role;
COMMENT ON FUNCTION public.reconcile_invalid_unbroadcast_withdrawal(uuid,uuid,text)
IS 'Master Admin-confirmed cancellation/refund only for fully approved invalid-TRON-wallet withdrawals that have not started or broadcast; requires explicit reason and restores gross amount once.';
