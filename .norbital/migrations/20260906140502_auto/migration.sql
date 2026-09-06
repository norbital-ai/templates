ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_source_request_id_leave_requests_fk" FOREIGN KEY ("source_request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE;
