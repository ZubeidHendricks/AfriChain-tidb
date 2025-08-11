"""
Circuit Manager for managing Circom circuits and zkSNARK compilation.

Handles circuit compilation, trusted setup coordination, and circuit lifecycle
management for the zkSNARK proof system.
"""

import asyncio
import os
import json
import subprocess
import tempfile
import shutil
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from uuid import uuid4
from pathlib import Path

import structlog
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..models.zkproof import ZKProofCircuit
from ..services.file_storage_service import FileStorageService

logger = structlog.get_logger(__name__)


@dataclass
class CircuitCompilationResult:
    """Result of circuit compilation."""
    success: bool
    circuit_file_path: str
    wasm_file_path: str
    r1cs_file_path: str
    compilation_log: str
    constraint_count: int
    witness_size: int
    public_input_count: int


@dataclass
class CircuitTemplate:
    """Circuit template definition."""
    name: str
    description: str
    circom_code: str
    template_params: Dict[str, Any]
    expected_constraints: int
    test_inputs: Dict[str, Any]


class CircuitManager:
    """Manager for Circom circuits and zkSNARK operations."""
    
    def __init__(self):
        """Initialize circuit manager."""
        self.file_storage_service: Optional[FileStorageService] = None
        
        # Circuit configuration
        self.circuits_base_path = "/opt/circuits"
        self.compiled_circuits_path = "/opt/circuits/compiled"
        self.templates_path = "/opt/circuits/templates"
        
        # Ensure directories exist
        os.makedirs(self.circuits_base_path, exist_ok=True)
        os.makedirs(self.compiled_circuits_path, exist_ok=True)
        os.makedirs(self.templates_path, exist_ok=True)
        
        # Circuit cache
        self.circuit_cache = {}
        self.compilation_cache = {}
        
        # Default circuit templates
        self.default_templates = self._create_default_templates()
    
    async def compile_circuit(
        self,
        circuit_name: str,
        circom_code: str,
        circuit_version: str = "1.0"
    ) -> CircuitCompilationResult:
        """
        Compile Circom circuit and generate necessary files.
        
        Args:
            circuit_name: Name of the circuit
            circom_code: Circom circuit code
            circuit_version: Version of the circuit
            
        Returns:
            Compilation result
        """
        try:
            # Create temporary directory for compilation
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                # Write circuit code to file
                circuit_file = temp_path / f"{circuit_name}.circom"
                circuit_file.write_text(circom_code)
                
                # Compile circuit
                compilation_result = await self._compile_circom_circuit(
                    str(circuit_file), temp_path, circuit_name
                )
                
                if not compilation_result.success:
                    return compilation_result
                
                # Move compiled files to permanent location
                permanent_dir = Path(self.compiled_circuits_path) / circuit_name / circuit_version
                permanent_dir.mkdir(parents=True, exist_ok=True)
                
                # Copy files
                circuit_dest = permanent_dir / f"{circuit_name}.circom"
                wasm_dest = permanent_dir / f"{circuit_name}.wasm"
                r1cs_dest = permanent_dir / f"{circuit_name}.r1cs"
                
                shutil.copy2(compilation_result.circuit_file_path, circuit_dest)
                shutil.copy2(compilation_result.wasm_file_path, wasm_dest)
                shutil.copy2(compilation_result.r1cs_file_path, r1cs_dest)
                
                # Create witness generation script
                await self._create_witness_generation_script(permanent_dir, circuit_name)
                
                # Update result with permanent paths
                compilation_result.circuit_file_path = str(circuit_dest)
                compilation_result.wasm_file_path = str(wasm_dest)
                compilation_result.r1cs_file_path = str(r1cs_dest)
                
                logger.info(
                    "Circuit compiled successfully",
                    circuit_name=circuit_name,
                    version=circuit_version,
                    constraints=compilation_result.constraint_count
                )
                
                return compilation_result
                
        except Exception as e:
            logger.error("Failed to compile circuit", circuit_name=circuit_name, error=str(e))
            return CircuitCompilationResult(
                success=False,
                circuit_file_path="",
                wasm_file_path="",
                r1cs_file_path="",
                compilation_log=str(e),
                constraint_count=0,
                witness_size=0,
                public_input_count=0
            )
    
    async def deploy_circuit(
        self,
        circuit_name: str,
        circuit_version: str,
        description: Optional[str] = None
    ) -> str:
        """
        Deploy compiled circuit to the system.
        
        Args:
            circuit_name: Name of the circuit
            circuit_version: Version of the circuit
            description: Optional description
            
        Returns:
            Circuit ID
        """
        try:
            # Verify circuit files exist
            circuit_dir = Path(self.compiled_circuits_path) / circuit_name / circuit_version
            if not circuit_dir.exists():
                raise ValueError(f"Circuit {circuit_name} v{circuit_version} not found")
            
            r1cs_file = circuit_dir / f"{circuit_name}.r1cs"
            if not r1cs_file.exists():
                raise ValueError(f"R1CS file not found for circuit {circuit_name}")
            
            async with get_db_session() as session:
                # Check if circuit already exists
                existing_query = select(ZKProofCircuit).where(
                    and_(
                        ZKProofCircuit.circuit_name == circuit_name,
                        ZKProofCircuit.circuit_version == circuit_version
                    )
                )
                existing_result = await session.execute(existing_query)
                existing_circuit = existing_result.scalar_one_or_none()
                
                if existing_circuit:
                    logger.warning(
                        "Circuit already deployed",
                        circuit_name=circuit_name,
                        version=circuit_version,
                        circuit_id=existing_circuit.id
                    )
                    return existing_circuit.id
                
                # Create circuit record
                circuit = ZKProofCircuit(
                    id=str(uuid4()),
                    circuit_name=circuit_name,
                    circuit_version=circuit_version,
                    circuit_file_path=str(r1cs_file),
                    proving_key_path="",  # Will be set during trusted setup
                    verification_key_path="",  # Will be set during trusted setup
                    trusted_setup_hash="",  # Will be set during trusted setup
                    is_active=False,  # Activated after trusted setup
                    circuit_description=description,
                    created_at=datetime.utcnow()
                )
                
                # Get circuit statistics
                stats = await self._analyze_circuit_stats(str(r1cs_file))
                circuit.constraint_count = stats.get("constraint_count", 0)
                circuit.witness_size = stats.get("witness_size", 0)
                circuit.public_input_count = stats.get("public_input_count", 0)
                
                session.add(circuit)
                await session.commit()
                
                logger.info(
                    "Circuit deployed",
                    circuit_id=circuit.id,
                    circuit_name=circuit_name,
                    version=circuit_version
                )
                
                return circuit.id
                
        except Exception as e:
            logger.error("Failed to deploy circuit", circuit_name=circuit_name, error=str(e))
            raise
    
    async def get_circuit_by_name(
        self,
        circuit_name: str,
        version: Optional[str] = None
    ) -> Optional[ZKProofCircuit]:
        """Get circuit by name and optional version."""
        try:
            async with get_db_session() as session:
                query = select(ZKProofCircuit).where(ZKProofCircuit.circuit_name == circuit_name)
                
                if version:
                    query = query.where(ZKProofCircuit.circuit_version == version)
                else:
                    # Get latest version
                    query = query.where(ZKProofCircuit.is_active == True)
                
                query = query.order_by(ZKProofCircuit.created_at.desc()).limit(1)
                
                result = await session.execute(query)
                return result.scalar_one_or_none()
                
        except Exception as e:
            logger.error("Failed to get circuit", circuit_name=circuit_name, error=str(e))
            return None
    
    async def list_circuits(
        self,
        active_only: bool = True
    ) -> List[ZKProofCircuit]:
        """List all circuits."""
        try:
            async with get_db_session() as session:
                query = select(ZKProofCircuit)
                
                if active_only:
                    query = query.where(ZKProofCircuit.is_active == True)
                
                query = query.order_by(ZKProofCircuit.circuit_name, ZKProofCircuit.created_at.desc())
                
                result = await session.execute(query)
                return result.scalars().all()
                
        except Exception as e:
            logger.error("Failed to list circuits", error=str(e))
            return []
    
    async def activate_circuit(self, circuit_id: str) -> bool:
        """Activate a circuit after trusted setup."""
        try:
            async with get_db_session() as session:
                # Deactivate other versions of the same circuit
                circuit_query = select(ZKProofCircuit).where(ZKProofCircuit.id == circuit_id)
                circuit_result = await session.execute(circuit_query)
                circuit = circuit_result.scalar_one_or_none()
                
                if not circuit:
                    raise ValueError(f"Circuit {circuit_id} not found")
                
                # Deactivate other versions
                await session.execute(
                    update(ZKProofCircuit)
                    .where(
                        and_(
                            ZKProofCircuit.circuit_name == circuit.circuit_name,
                            ZKProofCircuit.id != circuit_id
                        )
                    )
                    .values(is_active=False)
                )
                
                # Activate this circuit
                circuit.is_active = True
                await session.commit()
                
                logger.info("Circuit activated", circuit_id=circuit_id, circuit_name=circuit.circuit_name)
                
                return True
                
        except Exception as e:
            logger.error("Failed to activate circuit", circuit_id=circuit_id, error=str(e))
            return False
    
    async def test_circuit(
        self,
        circuit_id: str,
        test_inputs: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Test circuit with provided inputs."""
        try:
            async with get_db_session() as session:
                circuit_query = select(ZKProofCircuit).where(ZKProofCircuit.id == circuit_id)
                circuit_result = await session.execute(circuit_query)
                circuit = circuit_result.scalar_one_or_none()
                
                if not circuit:
                    raise ValueError(f"Circuit {circuit_id} not found")
                
                # Find circuit directory
                circuit_dir = Path(circuit.circuit_file_path).parent
                wasm_file = circuit_dir / f"{circuit.circuit_name}.wasm"
                
                if not wasm_file.exists():
                    raise ValueError(f"WASM file not found for circuit {circuit.circuit_name}")
                
                # Create temporary input file
                with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                    json.dump(test_inputs, f)
                    input_file = f.name
                
                # Generate witness
                witness_file = input_file.replace('.json', '.wtns')
                
                success = await self._generate_witness_for_test(
                    str(wasm_file), input_file, witness_file
                )
                
                # Cleanup
                try:
                    os.unlink(input_file)
                    if os.path.exists(witness_file):
                        os.unlink(witness_file)
                except OSError:
                    pass
                
                result = {
                    "circuit_id": circuit_id,
                    "test_successful": success,
                    "test_inputs": test_inputs,
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                logger.info(
                    "Circuit test completed",
                    circuit_id=circuit_id,
                    success=success
                )
                
                return result
                
        except Exception as e:
            logger.error("Failed to test circuit", circuit_id=circuit_id, error=str(e))
            return {
                "circuit_id": circuit_id,
                "test_successful": False,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
    
    async def create_circuit_from_template(
        self,
        template_name: str,
        circuit_name: str,
        template_params: Dict[str, Any]
    ) -> str:
        """Create circuit from template."""
        try:
            template = self.default_templates.get(template_name)
            if not template:
                raise ValueError(f"Template {template_name} not found")
            
            # Substitute template parameters
            circom_code = template.circom_code
            for param, value in template_params.items():
                circom_code = circom_code.replace(f"{{{param}}}", str(value))
            
            # Compile circuit
            compilation_result = await self.compile_circuit(
                circuit_name, circom_code, "1.0"
            )
            
            if not compilation_result.success:
                raise ValueError(f"Circuit compilation failed: {compilation_result.compilation_log}")
            
            # Deploy circuit
            circuit_id = await self.deploy_circuit(
                circuit_name, "1.0", template.description
            )
            
            logger.info(
                "Circuit created from template",
                template_name=template_name,
                circuit_name=circuit_name,
                circuit_id=circuit_id
            )
            
            return circuit_id
            
        except Exception as e:
            logger.error("Failed to create circuit from template", template_name=template_name, error=str(e))
            raise
    
    # Helper methods
    
    async def _compile_circom_circuit(
        self,
        circuit_file: str,
        output_dir: Path,
        circuit_name: str
    ) -> CircuitCompilationResult:
        """Compile Circom circuit using circom compiler."""
        try:
            # Compile to R1CS
            r1cs_file = output_dir / f"{circuit_name}.r1cs"
            wasm_file = output_dir / f"{circuit_name}.wasm"
            
            cmd = [
                "circom",
                circuit_file,
                "--r1cs",
                "--wasm",
                "--output", str(output_dir)
            ]
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else "Unknown compilation error"
                return CircuitCompilationResult(
                    success=False,
                    circuit_file_path=circuit_file,
                    wasm_file_path="",
                    r1cs_file_path="",
                    compilation_log=error_msg,
                    constraint_count=0,
                    witness_size=0,
                    public_input_count=0
                )
            
            # Analyze R1CS file for statistics
            stats = await self._analyze_r1cs_file(str(r1cs_file))
            
            return CircuitCompilationResult(
                success=True,
                circuit_file_path=circuit_file,
                wasm_file_path=str(wasm_file),
                r1cs_file_path=str(r1cs_file),
                compilation_log=stdout.decode(),
                constraint_count=stats.get("constraint_count", 0),
                witness_size=stats.get("witness_size", 0),
                public_input_count=stats.get("public_input_count", 0)
            )
            
        except Exception as e:
            return CircuitCompilationResult(
                success=False,
                circuit_file_path=circuit_file,
                wasm_file_path="",
                r1cs_file_path="",
                compilation_log=str(e),
                constraint_count=0,
                witness_size=0,
                public_input_count=0
            )
    
    async def _create_witness_generation_script(
        self,
        circuit_dir: Path,
        circuit_name: str
    ) -> None:
        """Create witness generation script for the circuit."""
        script_content = f'''#!/usr/bin/env node
const wasm_tester = require("circom_tester").wasm;
const fs = require("fs");
const path = require("path");

async function generateWitness(wasmFile, inputFile, witnessFile) {{
    const circuit = await wasm_tester(wasmFile);
    const input = JSON.parse(fs.readFileSync(inputFile));
    const witness = await circuit.calculateWitness(input);
    await circuit.saveWitness(witness, witnessFile);
}}

if (process.argv.length !== 5) {{
    console.error("Usage: node generate_witness.js <wasm_file> <input_file> <witness_file>");
    process.exit(1);
}}

const [,, wasmFile, inputFile, witnessFile] = process.argv;
generateWitness(wasmFile, inputFile, witnessFile)
    .then(() => console.log("Witness generated successfully"))
    .catch(error => {{
        console.error("Error generating witness:", error);
        process.exit(1);
    }});
'''
        
        script_file = circuit_dir / "generate_witness.js"
        script_file.write_text(script_content)
        script_file.chmod(0o755)
    
    async def _analyze_r1cs_file(self, r1cs_file: str) -> Dict[str, int]:
        """Analyze R1CS file to extract circuit statistics."""
        try:
            # Use snarkjs to get circuit info
            cmd = ["snarkjs", "r1cs", "info", r1cs_file]
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                logger.warning("Failed to analyze R1CS file", file=r1cs_file, error=stderr.decode())
                return {"constraint_count": 0, "witness_size": 0, "public_input_count": 0}
            
            # Parse output to extract statistics
            output = stdout.decode()
            stats = {"constraint_count": 0, "witness_size": 0, "public_input_count": 0}
            
            for line in output.split('\n'):
                if 'Constraints:' in line:
                    try:
                        stats["constraint_count"] = int(line.split(':')[1].strip())
                    except (IndexError, ValueError):
                        pass
                elif 'Private Inputs:' in line:
                    try:
                        private_inputs = int(line.split(':')[1].strip())
                        stats["witness_size"] = private_inputs
                    except (IndexError, ValueError):
                        pass
                elif 'Public Inputs:' in line:
                    try:
                        stats["public_input_count"] = int(line.split(':')[1].strip())
                    except (IndexError, ValueError):
                        pass
            
            return stats
            
        except Exception as e:
            logger.error("Failed to analyze R1CS file", file=r1cs_file, error=str(e))
            return {"constraint_count": 0, "witness_size": 0, "public_input_count": 0}
    
    async def _analyze_circuit_stats(self, r1cs_file: str) -> Dict[str, int]:
        """Wrapper for R1CS analysis."""
        return await self._analyze_r1cs_file(r1cs_file)
    
    async def _generate_witness_for_test(
        self,
        wasm_file: str,
        input_file: str,
        witness_file: str
    ) -> bool:
        """Generate witness for circuit testing."""
        try:
            # Find witness generation script
            circuit_dir = Path(wasm_file).parent
            script_file = circuit_dir / "generate_witness.js"
            
            if not script_file.exists():
                logger.error("Witness generation script not found", script=str(script_file))
                return False
            
            cmd = ["node", str(script_file), wasm_file, input_file, witness_file]
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                logger.error("Witness generation failed", error=stderr.decode())
                return False
            
            return os.path.exists(witness_file)
            
        except Exception as e:
            logger.error("Failed to generate witness for test", error=str(e))
            return False
    
    def _create_default_templates(self) -> Dict[str, CircuitTemplate]:
        """Create default circuit templates."""
        templates = {}
        
        # Product authenticity template
        templates["product_authenticity"] = CircuitTemplate(
            name="product_authenticity",
            description="Product authenticity verification circuit",
            circom_code='''
pragma circom 2.0.0;

include "poseidon.circom";
include "eddsamimc.circom";
include "comparators.circom";

template ProductAuthenticity() {
    // Private inputs (not revealed)
    signal private input productMetadataHash;
    signal private input brandSignature;
    signal private input timestampNonce;
    signal private input adminVerificationKey;
    
    // Public inputs (revealed)
    signal input publicProductId;
    signal input brandId;
    signal input verificationTimestamp;
    
    // Public output
    signal output isAuthentic;
    
    // Components for verification
    component hasher = Poseidon(4);
    component signatureCheck = EdDSAMiMCVerifier();
    component timestampCheck = GreaterThan(64);
    
    // Hash product metadata
    hasher.inputs[0] <== productMetadataHash;
    hasher.inputs[1] <== brandSignature;
    hasher.inputs[2] <== timestampNonce;
    hasher.inputs[3] <== publicProductId;
    
    // Verify brand signature
    signatureCheck.enabled <== 1;
    signatureCheck.Ax <== brandSignature;
    signatureCheck.Ay <== brandId;
    signatureCheck.S <== adminVerificationKey;
    signatureCheck.R8x <== hasher.out;
    
    // Verify timestamp is recent
    timestampCheck.in[0] <== verificationTimestamp;
    timestampCheck.in[1] <== timestampNonce;
    
    // Output authenticity result
    isAuthentic <== signatureCheck.valid * timestampCheck.out;
}

component main = ProductAuthenticity();
            ''',
            template_params={},
            expected_constraints=1000,
            test_inputs={
                "productMetadataHash": "123456789",
                "brandSignature": "987654321",
                "timestampNonce": "1640995200",
                "adminVerificationKey": "admin_key_123",
                "publicProductId": "product_123",
                "brandId": "brand_456",
                "verificationTimestamp": "1640995200"
            }
        )
        
        # Brand verification template
        templates["brand_verification"] = CircuitTemplate(
            name="brand_verification",
            description="Brand identity verification circuit",
            circom_code='''
pragma circom 2.0.0;

include "poseidon.circom";
include "eddsamimc.circom";

template BrandVerification() {
    // Private inputs
    signal private input businessRegistrationHash;
    signal private input trademarkHash;
    signal private input legalEntityHash;
    signal private input adminSignature;
    
    // Public inputs
    signal input brandId;
    signal input verificationTimestamp;
    signal input brandNameHash;
    
    // Public output
    signal output isVerified;
    
    // Hash all verification data
    component hasher = Poseidon(4);
    hasher.inputs[0] <== businessRegistrationHash;
    hasher.inputs[1] <== trademarkHash;
    hasher.inputs[2] <== legalEntityHash;
    hasher.inputs[3] <== brandNameHash;
    
    // Verify admin signature
    component signatureCheck = EdDSAMiMCVerifier();
    signatureCheck.enabled <== 1;
    signatureCheck.Ax <== adminSignature;
    signatureCheck.Ay <== brandId;
    signatureCheck.R8x <== hasher.out;
    
    // Output verification result
    isVerified <== signatureCheck.valid;
}

component main = BrandVerification();
            ''',
            template_params={},
            expected_constraints=800,
            test_inputs={
                "businessRegistrationHash": "business_123",
                "trademarkHash": "trademark_456",
                "legalEntityHash": "legal_789",
                "adminSignature": "admin_sig_123",
                "brandId": "brand_123",
                "verificationTimestamp": "1640995200",
                "brandNameHash": "brand_name_456"
            }
        )
        
        return templates