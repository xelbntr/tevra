-- Align relative sample dates with the project's Jakarta classroom calendar.
alter function private.ensure_sample_workspace() set timezone = 'Asia/Jakarta';
