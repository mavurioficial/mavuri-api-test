import io
import zipfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from watcher import check_plan, check_terraform

PLAN = """
# oci_core_instance.generated_oci_core_instance will be created
+ resource "oci_core_instance" "generated_oci_core_instance" {
+ availability_domain = "KYUE:SA-SAOPAULO-1-AD-1"
+ shape = "VM.Standard.A1.Flex"
+ create_vnic_details {
+ assign_public_ip = "true"
+ subnet_id = "ocid1.subnet.oc1.sa-saopaulo-1.fake"
+ }
+ shape_config {
+ memory_in_gbs = 4
+ ocpus = 1
+ }
+ }
Plan: 1 to add, 0 to change, 0 to destroy.
"""

class Tests(unittest.TestCase):
    def test_safe(self): check_plan(PLAN)
    def test_other_cpu(self):
        with self.assertRaises(RuntimeError): check_plan(PLAN.replace("ocpus = 1","ocpus = 2"))
    def test_decimal_cpu(self):
        with self.assertRaises(RuntimeError): check_plan(PLAN.replace("ocpus = 1","ocpus = 1.5"))
    def test_other_memory(self):
        with self.assertRaises(RuntimeError): check_plan(PLAN.replace("memory_in_gbs = 4","memory_in_gbs = 8"))
    def test_other_shape(self):
        with self.assertRaises(RuntimeError): check_plan(PLAN.replace("VM.Standard.A1.Flex","VM.Standard.E4.Flex"))
    def test_no_public_ip(self):
        with self.assertRaises(RuntimeError): check_plan(PLAN.replace('assign_public_ip = "true"','assign_public_ip = "false"'))
    def test_wrong_region(self):
        with self.assertRaises(RuntimeError): check_plan(PLAN.replace("KYUE:SA-SAOPAULO-1-AD-1","SOME-OTHER-AD"))
    def test_destroy(self):
        with self.assertRaises(RuntimeError): check_plan(PLAN.replace("0 to destroy","1 to destroy"))
    def test_extra_resource(self):
        with self.assertRaises(RuntimeError): check_plan(PLAN.replace("Plan: 1", "# oci_core_volume.fake will be created\nPlan: 1"))
    def test_wrong_terraform(self):
        b=io.BytesIO()
        with zipfile.ZipFile(b,"w") as z: z.writestr("main.tf","different code")
        with self.assertRaises(RuntimeError): check_terraform(b.getvalue())

if __name__ == "__main__":
    unittest.main()
