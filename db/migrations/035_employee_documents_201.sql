-- 035_employee_documents_201.sql
-- Extend employee_document for Digital 201 File Vault & Policy Acknowledgment

ALTER TABLE employee_document ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE employee_document ALTER COLUMN file_url SET DEFAULT '';
ALTER TABLE employee_document ADD COLUMN IF NOT EXISTS mime_type varchar(120) NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE employee_document ADD COLUMN IF NOT EXISTS file_data_base64 text;
ALTER TABLE employee_document ADD COLUMN IF NOT EXISTS requires_ack boolean NOT NULL DEFAULT false;
ALTER TABLE employee_document ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE employee_document ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES employee(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employee_document_org_emp
  ON employee_document(org_id, employee_id, uploaded_at DESC);

DROP POLICY IF EXISTS employee_document_tenant_isolation ON employee_document;
