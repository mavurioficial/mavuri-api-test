#!/usr/bin/env python3
"""Mavuri OCI A1 capacity monitor. Fail closed; never apply arbitrary Terraform."""
from __future__ import annotations
import hashlib, io, os, re, sys, tempfile, time, zipfile
from pathlib import Path

SHAPE = "VM.Standard.A1.Flex"
REGION = "sa-saopaulo-1"
AD = "KYUE:SA-SAOPAULO-1-AD-1"
INSTANCE = "mavuri-waha"
RESOURCE = "oci_core_instance.generated_oci_core_instance"
OCPUS = 1
MEM_GB = 4
APPROVED_SHA = "edea25ba2af70f47a085861b217b6f56884b1b8034cf9e213154793ecd8aab57"
ACTIVE = {"ACCEPTED", "IN_PROGRESS", "CANCELING"}
TERMINAL = {"SUCCEEDED", "FAILED", "CANCELED"}

def record(msg):
    print(msg, flush=True)
    f = os.environ.get("GITHUB_STEP_SUMMARY")
    if f:
        with open(f, "a", encoding="utf-8") as out: out.write(msg + "\n")

def binary(data):
    if isinstance(data, str): return data.encode()
    if isinstance(data, (bytes, bytearray)): return bytes(data)
    if hasattr(data, "content"):
        v = data.content
        if isinstance(v, (bytes, bytearray)): return bytes(v)
    if hasattr(data, "read"): return binary(data.read())
    if hasattr(data, "raw"): return binary(data.raw.read())
    raise RuntimeError("OCI response is not readable")

def check_terraform(data):
    with zipfile.ZipFile(io.BytesIO(binary(data))) as z:
        files = [name for name in z.namelist() if not name.endswith("/")]
        if files != ["main.tf"]: raise RuntimeError("Unapproved Terraform ZIP files")
        digest = hashlib.sha256(z.read("main.tf")).hexdigest()
        if digest != APPROVED_SHA:
            raise RuntimeError("Terraform content changed; apply blocked")
    return True

def check_plan(plan):
    matches = re.findall(r"\bPlan:\s*(\d+) to add,\s*(\d+) to change,\s*(\d+) to destroy", plan)
    if not matches or matches[-1] != ("1", "0", "0"):
        raise RuntimeError("Plan resource count changed: " + str(matches[-1:]))
    headers = re.findall(r"#\s+([\w.\[\]-]+)\s+will be created", plan)
    if headers != [RESOURCE]:
        raise RuntimeError("Plan would create an unapproved resource: " + str(headers))
    patterns = [
        r'\+\s+shape\s*=\s*"VM\.Standard\.A1\.Flex"',
        r'\+\s+ocpus\s*=\s*1(?=\s|$)',
        r'\+\s+memory_in_gbs\s*=\s*4(?=\s|$)',
        r'\+\s+assign_public_ip\s*=\s*"true"',
        r'\+\s+subnet_id\s*=\s*"ocid1\.subnet\.oc1\.sa-saopaulo-1\.',
        r'\+\s+availability_domain\s*=\s*"KYUE:SA-SAOPAULO-1-AD-1"',
    ]
    if any(not re.search(p, plan) for p in patterns):
        raise RuntimeError("Plan VM dimensions or location do not match approval")
    if re.search(r"#\s+\S+\s+will be (?:destroyed|updated|replaced)", plan):
        raise RuntimeError("Plan would mutate existing resources")
    return True

def wait_job(rm, job_id, timeout=420):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        state = rm.get_job(job_id).data.lifecycle_state
        if state in TERMINAL: return state
        if state not in ACTIVE: raise RuntimeError("Unknown job status: " + str(state))
        time.sleep(15)
    raise RuntimeError("Job timeout; do not retry without reviewing jobs")

def main():
    import oci
    names = ("OCI_USER_OCID", "OCI_TENANCY_OCID", "OCI_FINGERPRINT",
             "OCI_PRIVATE_KEY_PEM", "OCI_STACK_OCID", "OCI_COMPARTMENT_OCID")
    missing = [key for key in names if not os.environ.get(key)]
    if missing: raise RuntimeError("Missing credentials/settings: " + ", ".join(missing))
    if os.environ["OCI_TENANCY_OCID"] != os.environ["OCI_COMPARTMENT_OCID"]:
        raise RuntimeError("Only the verified root compartment is allowed")
    sid = os.environ["OCI_STACK_OCID"]
    if not sid.startswith("ocid1.ormstack.oc1.sa-saopaulo-1."):
        raise RuntimeError("Stack id/region mismatch")
    enabled = os.environ.get("ENABLE_APPLY", "false").lower() == "true"

    fd, key_file = tempfile.mkstemp(prefix="oci-key-", suffix=".pem")
    try:
        os.chmod(key_file, 0o600)
        with os.fdopen(fd, "w") as out:
            out.write(os.environ["OCI_PRIVATE_KEY_PEM"].replace("\\n", "\n"))
        config = {
            "user": os.environ["OCI_USER_OCID"],
            "tenancy": os.environ["OCI_TENANCY_OCID"],
            "fingerprint": os.environ["OCI_FINGERPRINT"],
            "key_file": key_file,
            "region": REGION,
        }
        oci.config.validate_config(config)
        compute = oci.core.ComputeClient(config)
        rm = oci.resource_manager.ResourceManagerClient(config)
        compartment = os.environ["OCI_COMPARTMENT_OCID"]
        record("Mavuri A1 capacity — " + ("creation enabled" if enabled else "READ ONLY"))
        stack = rm.get_stack(sid).data
        if stack.compartment_id != compartment or stack.display_name != INSTANCE:
            raise RuntimeError("Wrong stack name or compartment")
        if enabled:
            check_terraform(rm.get_stack_tf_config(sid).data)
            record("Terraform configuration signature verified.")

        def instances():
            return oci.pagination.list_call_get_all_results(
                compute.list_instances, compartment_id=compartment).data

        if any(i.display_name == INSTANCE and i.lifecycle_state not in
               ("TERMINATED", "TERMINATING") for i in instances()):
            record("VM already exists; no action.")
            return
        jobs = oci.pagination.list_call_get_all_results(rm.list_jobs, stack_id=sid).data
        if any(j.lifecycle_state in ACTIVE for j in jobs):
            record("Existing active Terraform job; no action.")
            return

        details = oci.core.models.CreateComputeCapacityReportDetails(
            compartment_id=compartment, availability_domain=AD,
            shape_availabilities=[
                oci.core.models.CreateCapacityReportShapeAvailabilityDetails(
                    instance_shape=SHAPE,
                    instance_shape_config=oci.core.models.CapacityReportInstanceShapeConfig(
                        ocpus=OCPUS, memory_in_gbs=MEM_GB))
            ])
        offers = compute.create_compute_capacity_report(details).data.shape_availabilities
        if len(offers) != 1: raise RuntimeError("Unexpected capacity response")
        item = offers[0]
        record(f"Oracle: {item.availability_status}; available_count={item.available_count}")
        if item.availability_status != "AVAILABLE":
            return
        if item.available_count is not None and item.available_count < 1:
            return
        if not enabled:
            record("Capacity exists but ENABLE_APPLY is false. No VM requested.")
            return

        p = oci.resource_manager.models.CreateJobDetails(
            stack_id=sid,
            job_operation_details=oci.resource_manager.models.CreatePlanJobOperationDetails(),
            display_name="mavuri-oci-safe-plan")
        plan_id = rm.create_job(p).data.id
        if wait_job(rm, plan_id) != "SUCCEEDED":
            raise RuntimeError("Terraform Plan failed: " + plan_id)
        plan_log = binary(rm.get_job_logs_content(plan_id).data).decode("utf-8", "replace")
        check_plan(plan_log)
        record("New Terraform Plan verified (1 VM, 0 changes, 0 destroy).")

        # Last checks before sending Apply; GitHub concurrency prevents overlapping runs.
        jobs = oci.pagination.list_call_get_all_results(rm.list_jobs, stack_id=sid).data
        if any(j.lifecycle_state in ACTIVE and j.id != plan_id for j in jobs):
            raise RuntimeError("Concurrent job detected: stopped")
        if any(i.display_name == INSTANCE and i.lifecycle_state not in
               ("TERMINATED", "TERMINATING") for i in instances()):
            raise RuntimeError("Instance appeared during Plan: stopped")
        a = oci.resource_manager.models.CreateJobDetails(
            stack_id=sid,
            job_operation_details=oci.resource_manager.models.CreateApplyJobOperationDetails(
                execution_plan_strategy="FROM_PLAN_JOB_ID",
                execution_plan_job_id=plan_id),
            display_name="mavuri-oci-safe-apply")
        apply_id = rm.create_job(a).data.id
        record("Apply started from verified Plan: " + apply_id)
        status = wait_job(rm, apply_id)
        if status != "SUCCEEDED":
            raise RuntimeError("Apply did not complete: " + status + ", job=" + apply_id)
        record("VM created successfully. Disable ENABLE_APPLY to freeze automatic writes.")
    finally:
        Path(key_file).unlink(missing_ok=True)

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("SAFE STOP: " + str(exc), file=sys.stderr, flush=True)
        sys.exit(1)
