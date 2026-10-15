ALTER TABLE codes ADD COLUMN client_uid TEXT;

CREATE UNIQUE INDEX codes_client_uid ON codes (client_uid);
