-- AegisPay baseline demo/testnet configuration recovered from complete backup.
-- Non-destructive: only fills intentionally empty configuration/catalog tables and restores private evidence bucket.

INSERT INTO public.platform_settings(key,value_json,updated_at) VALUES
('deposit_rules', jsonb_build_object(
  'network','TRON TESTNET',
  'receiving_address','THF68ipA3NK2V4mCxNBk8JWJGkU6a5cngg',
  'token_contract','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
  'fee',2
), now()),
('cycle_rules', jsonb_build_object('hours',18), now()),
('referral_rules', jsonb_build_object('level_1',5,'level_2',2), now()),
('withdrawal_rules', jsonb_build_object('minimum',50,'fee_rate',0.10), now())
ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json, updated_at=EXCLUDED.updated_at;

INSERT INTO public.vip_tiers(id,name,deposit_amount,initial_profit,enabled,display_order,color_key) VALUES
('T1','Tier 1',30,5,true,1,'blue'),
('T2','Tier 2',50,10,true,2,'blue'),
('T3','Tier 3',100,15,true,3,'blue'),
('V1','VVIP 1',250,40,true,4,'gold'),
('V2','VVIP 2',500,65,true,5,'gold'),
('V3','VVIP 3',1000,135,true,6,'gold')
ON CONFLICT(id) DO UPDATE SET
 name=EXCLUDED.name,deposit_amount=EXCLUDED.deposit_amount,initial_profit=EXCLUDED.initial_profit,
 enabled=EXCLUDED.enabled,display_order=EXCLUDED.display_order,color_key=EXCLUDED.color_key,updated_at=now();

INSERT INTO public.shop_offers(title,subtitle,task_level,tier_min_id,reward_text,status,instructions,product_id)
VALUES
('Phone Grip Stand','Aegis Mobile · Accessories','CLIENT','T1','Cycle task','ACTIVE','Complete the assigned Phone Grip Stand Shop task.','SP-4'),
('Wireless Mouse','Aegis Tech · Computer Accessories','CLIENT','T1','Cycle task','ACTIVE','Complete the assigned Wireless Mouse Shop task.','SP-8'),
('Smart Tracker Tag','Aegis Tech · Smart Devices','CLIENT','T2','Cycle task','ACTIVE','Complete the assigned Smart Tracker Tag Shop task.','SP-16'),
('Running Shoes Lite','Aegis Sport · Footwear','CLIENT','T2','Cycle task','ACTIVE','Complete the assigned Running Shoes Lite Shop task.','SP-19'),
('Mechanical Keyboard','Aegis Tech · PC Gaming','CLIENT','T3','Cycle task','ACTIVE','Complete the assigned Mechanical Keyboard Shop task.','SP-21'),
('Noise Cancel Earbuds','Aegis Audio · Headphones','CLIENT','T3','Cycle task','ACTIVE','Complete the assigned Noise Cancel Earbuds Shop task.','SP-24'),
('Gaming Headset Elite','Aegis Game · PC Gaming','CLIENT','V1','Cycle task','ACTIVE','Complete the assigned Gaming Headset Elite Shop task.','SP-32'),
('Travel Smart Luggage','Aegis Outdoor · Travel','CLIENT','V1','Cycle task','ACTIVE','Complete the assigned Travel Smart Luggage Shop task.','SP-40'),
('Ultra Gaming Monitor','Aegis Game · PC Gaming','CLIENT','V2','Cycle task','ACTIVE','Complete the assigned Ultra Gaming Monitor Shop task.','SP-42'),
('Designer Carry-On','Aegis Style · Travel','CLIENT','V2','Cycle task','ACTIVE','Complete the assigned Designer Carry-On Shop task.','SP-44'),
('Flagship Smart Device','Aegis Tech · Smart Devices','CLIENT','V3','Cycle task','ACTIVE','Complete the assigned Flagship Smart Device Shop task.','SP-52'),
('Aegis Signature Collection','Aegis Style · Signature','CLIENT','V3','Cycle task','ACTIVE','Complete the assigned Aegis Signature Collection Shop task.','SP-57');

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('private-verification','private-verification',false,10485760,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET
 name=EXCLUDED.name,public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS verification_upload_own ON storage.objects;
CREATE POLICY verification_upload_own ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
 bucket_id='private-verification'
 AND public.app_runtime_enabled()
 AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
);

DROP POLICY IF EXISTS verification_read_own_or_master ON storage.objects;
CREATE POLICY verification_read_own_or_master ON storage.objects FOR SELECT TO authenticated
USING (
 bucket_id='private-verification'
 AND public.app_runtime_enabled()
 AND (
   (storage.foldername(name))[1]=(SELECT auth.uid())::text
   OR public.current_app_role()='MASTER ADMIN'
 )
);

DROP POLICY IF EXISTS verification_delete_own ON storage.objects;
CREATE POLICY verification_delete_own ON storage.objects FOR DELETE TO authenticated
USING (
 bucket_id='private-verification'
 AND public.app_runtime_enabled()
 AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
);