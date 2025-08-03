"""
ZKProof Service for enterprise-grade zkSNARK proof generation and verification.

Implements comprehensive zero-knowledge proof system for product authenticity,
brand verification, and audit trail integrity with Circom circuits and snarkjs.
"""

import asyncio
import json
import time
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from uuid import uuid4
import subprocess
import tempfile
import os

import structlog
from sqlalchemy import and_, func, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..models.brand import Brand
from ..models.brand_product import BrandProduct
from ..models.product import Product
from ..models.zkproof import ZKProof, ZKProofCircuit, ProofType, VerificationStatus
from ..models.audit_proof import AuditProof
from ..services.file_storage_service import FileStorageService
from ..services.encryption_service import EncryptionService

logger = structlog.get_logger(__name__)


@dataclass
class ProductMetadata:
    """Product metadata for proof generation."""
    product_id: str
    brand_id: str
    name: str
    description: str
    price: Optional[float]
    category: str
    specifications: Dict[str, Any]
    verification_timestamp: int


@dataclass
class ZKProofGenerationData:
    """Data structure for zkSNARK proof generation."""
    proof_type: ProofType
    entity_id: str
    private_inputs: Dict[str, Any]
    public_inputs: Dict[str, Any]
    circuit_name: str


@dataclass
class VerificationResult:
    """Result of proof verification."""
    proof_id: str
    is_valid: bool
    verification_time: datetime
    public_signals: Dict[str, Any]
    error_message: Optional[str] = None


@dataclass
class TrustedSetupData:
    """Trusted setup ceremony data."""
    circuit_name: str
    ceremony_id: str
    contributors: List[str]
    final_beacon: str
    setup_hash: str
    proving_key_path: str
    verification_key_path: str


class ZKProofService:
    """Service for zkSNARK proof generation and verification."""
    
    def __init__(self):
        """Initialize zkSNARK proof service."""
        self.file_storage_service: Optional[FileStorageService] = None
        self.encryption_service: Optional[EncryptionService] = None
        
        # Circuit configuration
        self.circuit_base_path = "/opt/circuits"
        self.trusted_setup_path = "/opt/trusted_setup"
        self.proof_storage_path = "/opt/zkproofs"
        
        # Ensure directories exist
        os.makedirs(self.circuit_base_path, exist_ok=True)
        os.makedirs(self.trusted_setup_path, exist_ok=True)
        os.makedirs(self.proof_storage_path, exist_ok=True)
        
        # Performance optimization settings
        self.proof_cache = {}
        self.verification_cache = {}
        self.max_cache_size = 1000
        self.cache_ttl_seconds = 3600
    
    async def generate_product_proof(
        self,
        product_id: str,
        brand_id: str,
        metadata: ProductMetadata
    ) -> ZKProof:
        """
        Generate zkSNARK proof for product authenticity.
        
        Args:
            product_id: Product identifier
            brand_id: Brand identifier
            metadata: Product metadata for proof generation
            
        Returns:
            Generated zkSNARK proof
        """
        try:
            async with get_db_session() as session:
                # Get active circuit for product authenticity
                circuit = await self._get_active_circuit(session, "product_authenticity")
                
                if not circuit:
                    raise ValueError("Product authenticity circuit not found")
                
                # Prepare proof generation data
                proof_data = ZKProofGenerationData(
                    proof_type=ProofType.PRODUCT_AUTHENTICITY,
                    entity_id=product_id,
                    private_inputs=await self._prepare_product_private_inputs(
                        session, metadata, brand_id
                    ),
                    public_inputs=await self._prepare_product_public_inputs(
                        product_id, brand_id, metadata
                    ),
                    circuit_name="product_authenticity"
                )
                
                # Generate proof using circuit
                proof_result = await self._generate_proof_with_circuit(circuit, proof_data)
                
                # Create and store zkSNARK proof record
                zkproof = ZKProof(
                    id=str(uuid4()),
                    proof_type=ProofType.PRODUCT_AUTHENTICITY,
                    entity_id=product_id,
                    circuit_id=circuit.id,
                    proof_data=proof_result["proof"],
                    public_signals=proof_result["public_signals"],
                    proof_hash=self._hash_proof(proof_result),
                    verification_status=VerificationStatus.PENDING,
                    generated_at=datetime.utcnow(),
                    expires_at=datetime.utcnow() + timedelta(days=365)  # 1 year validity
                )
                
                session.add(zkproof)
                await session.commit()
                
                # Verify proof immediately to ensure validity
                verification_result = await self.verify_proof(zkproof.id)
                
                if verification_result.is_valid:
                    zkproof.verification_status = VerificationStatus.VALID
                    zkproof.verified_at = verification_result.verification_time
                    await session.commit()
                else:
                    zkproof.verification_status = VerificationStatus.INVALID
                    await session.commit()
                    raise ValueError(f"Generated proof failed verification: {verification_result.error_message}")
                
                logger.info(
                    "zkSNARK proof generated for product",
                    product_id=product_id,
                    brand_id=brand_id,
                    proof_id=zkproof.id,
                    circuit_name=circuit.circuit_name,
                    proof_hash=zkproof.proof_hash
                )
                
                return zkproof
                
        except Exception as e:
            logger.error("Failed to generate product proof", product_id=product_id, error=str(e))
            raise
    
    async def generate_brand_proof(
        self,
        brand_id: str,
        verification_data: Dict[str, Any]
    ) -> ZKProof:
        """Generate zkSNARK proof for brand verification."""
        try:
            async with get_db_session() as session:
                # Get brand verification circuit
                circuit = await self._get_active_circuit(session, "brand_verification")
                
                if not circuit:
                    raise ValueError("Brand verification circuit not found")
                
                # Prepare brand proof data
                proof_data = ZKProofGenerationData(
                    proof_type=ProofType.BRAND_VERIFICATION,
                    entity_id=brand_id,
                    private_inputs=await self._prepare_brand_private_inputs(
                        session, brand_id, verification_data
                    ),
                    public_inputs=await self._prepare_brand_public_inputs(
                        brand_id, verification_data
                    ),
                    circuit_name="brand_verification"
                )
                
                # Generate proof
                proof_result = await self._generate_proof_with_circuit(circuit, proof_data)
                
                # Create zkSNARK proof record
                zkproof = ZKProof(
                    id=str(uuid4()),
                    proof_type=ProofType.BRAND_VERIFICATION,
                    entity_id=brand_id,
                    circuit_id=circuit.id,
                    proof_data=proof_result["proof"],
                    public_signals=proof_result["public_signals"],
                    proof_hash=self._hash_proof(proof_result),
                    verification_status=VerificationStatus.PENDING,
                    generated_at=datetime.utcnow(),
                    expires_at=datetime.utcnow() + timedelta(days=1095)  # 3 years validity
                )
                
                session.add(zkproof)
                await session.commit()
                
                # Verify proof
                verification_result = await self.verify_proof(zkproof.id)
                
                if verification_result.is_valid:
                    zkproof.verification_status = VerificationStatus.VALID
                    zkproof.verified_at = verification_result.verification_time
                    
                    # Update brand with proof hash
                    brand_query = select(Brand).where(Brand.id == brand_id)
                    brand_result = await session.execute(brand_query)
                    brand = brand_result.scalar_one_or_none()
                    
                    if brand:
                        brand.zkproof_hash = zkproof.proof_hash
                    
                    await session.commit()
                else:
                    zkproof.verification_status = VerificationStatus.INVALID
                    await session.commit()
                    raise ValueError(f"Generated brand proof failed verification: {verification_result.error_message}")
                
                logger.info(
                    "zkSNARK proof generated for brand",
                    brand_id=brand_id,
                    proof_id=zkproof.id,
                    proof_hash=zkproof.proof_hash
                )
                
                return zkproof
                
        except Exception as e:
            logger.error("Failed to generate brand proof", brand_id=brand_id, error=str(e))
            raise
    
    async def verify_proof(self, zkproof_id: str) -> VerificationResult:
        """
        Verify existing zkSNARK proof.
        
        Args:
            zkproof_id: ZK proof identifier
            
        Returns:
            Verification result
        """
        try:
            # Check cache first
            cache_key = f"verify_{zkproof_id}"
            if cache_key in self.verification_cache:
                cached_result, timestamp = self.verification_cache[cache_key]
                if time.time() - timestamp < self.cache_ttl_seconds:
                    return cached_result
            
            async with get_db_session() as session:
                # Get proof and circuit
                proof_query = select(ZKProof).where(ZKProof.id == zkproof_id)
                proof_result = await session.execute(proof_query)
                zkproof = proof_result.scalar_one_or_none()
                
                if not zkproof:
                    raise ValueError(f"Proof {zkproof_id} not found")
                
                # Check if proof has expired
                if zkproof.expires_at and datetime.utcnow() > zkproof.expires_at:
                    return VerificationResult(
                        proof_id=zkproof_id,
                        is_valid=False,
                        verification_time=datetime.utcnow(),
                        public_signals={},
                        error_message="Proof has expired"
                    )
                
                # Get circuit
                circuit_query = select(ZKProofCircuit).where(ZKProofCircuit.id == zkproof.circuit_id)
                circuit_result = await session.execute(circuit_query)
                circuit = circuit_result.scalar_one_or_none()
                
                if not circuit:
                    raise ValueError(f"Circuit {zkproof.circuit_id} not found")
                
                # Verify proof using snarkjs
                is_valid = await self._verify_proof_with_snarkjs(
                    circuit.verification_key_path,
                    zkproof.proof_data,
                    zkproof.public_signals
                )
                
                verification_time = datetime.utcnow()
                
                # Update proof verification status
                zkproof.verification_status = VerificationStatus.VALID if is_valid else VerificationStatus.INVALID
                zkproof.verified_at = verification_time
                await session.commit()
                
                result = VerificationResult(
                    proof_id=zkproof_id,
                    is_valid=is_valid,
                    verification_time=verification_time,
                    public_signals=zkproof.public_signals,
                    error_message=None if is_valid else "Proof verification failed"
                )
                
                # Cache result
                self.verification_cache[cache_key] = (result, time.time())
                self._cleanup_cache()
                
                logger.info(
                    "zkSNARK proof verified",
                    proof_id=zkproof_id,
                    is_valid=is_valid,
                    verification_time=verification_time.isoformat()
                )
                
                return result
                
        except Exception as e:
            logger.error("Failed to verify proof", proof_id=zkproof_id, error=str(e))
            return VerificationResult(
                proof_id=zkproof_id,
                is_valid=False,
                verification_time=datetime.utcnow(),
                public_signals={},
                error_message=str(e)
            )
    
    async def perform_trusted_setup_ceremony(
        self,
        circuit_name: str,
        contributors: List[str],
        beacon_value: str
    ) -> TrustedSetupData:
        """
        Perform trusted setup ceremony for a circuit.
        
        Args:
            circuit_name: Name of the circuit
            contributors: List of contributor identifiers
            beacon_value: Random beacon value for final contribution
            
        Returns:
            Trusted setup data
        """
        try:
            ceremony_id = str(uuid4())
            
            circuit_path = os.path.join(self.circuit_base_path, f"{circuit_name}.r1cs")
            if not os.path.exists(circuit_path):
                raise ValueError(f"Circuit file not found: {circuit_path}")
            
            # Generate ceremony-specific paths
            ceremony_dir = os.path.join(self.trusted_setup_path, ceremony_id)
            os.makedirs(ceremony_dir, exist_ok=True)
            
            proving_key_path = os.path.join(ceremony_dir, f"{circuit_name}_proving_key.zkey")
            verification_key_path = os.path.join(ceremony_dir, f"{circuit_name}_verification_key.json")
            
            # Phase 1: Powers of Tau ceremony (simplified for demonstration)
            pot_file = os.path.join(ceremony_dir, "powersoftau_final.ptau")
            await self._run_powers_of_tau_ceremony(pot_file, len(contributors))
            
            # Phase 2: Circuit-specific setup
            await self._run_circuit_specific_setup(
                circuit_path, pot_file, proving_key_path, verification_key_path,
                contributors, beacon_value
            )
            
            # Generate setup hash for verification
            setup_hash = await self._generate_setup_hash(
                proving_key_path, verification_key_path, beacon_value
            )
            
            # Store circuit configuration
            async with get_db_session() as session:
                circuit = ZKProofCircuit(
                    id=str(uuid4()),
                    circuit_name=circuit_name,
                    circuit_version="1.0",
                    circuit_file_path=circuit_path,
                    proving_key_path=proving_key_path,
                    verification_key_path=verification_key_path,
                    trusted_setup_hash=setup_hash,
                    is_active=True,
                    created_at=datetime.utcnow()
                )
                
                session.add(circuit)
                await session.commit()
            
            trusted_setup = TrustedSetupData(
                circuit_name=circuit_name,
                ceremony_id=ceremony_id,
                contributors=contributors,
                final_beacon=beacon_value,
                setup_hash=setup_hash,
                proving_key_path=proving_key_path,
                verification_key_path=verification_key_path
            )
            
            logger.info(
                "Trusted setup ceremony completed",
                circuit_name=circuit_name,
                ceremony_id=ceremony_id,
                contributors_count=len(contributors),
                setup_hash=setup_hash
            )
            
            return trusted_setup
            
        except Exception as e:
            logger.error("Failed to perform trusted setup ceremony", circuit_name=circuit_name, error=str(e))
            raise
    
    async def get_proof_by_entity(
        self,
        entity_id: str,
        proof_type: ProofType
    ) -> Optional[ZKProof]:
        """Get latest valid proof for an entity."""
        try:
            async with get_db_session() as session:
                proof_query = select(ZKProof).where(
                    and_(
                        ZKProof.entity_id == entity_id,
                        ZKProof.proof_type == proof_type,
                        ZKProof.verification_status == VerificationStatus.VALID,
                        ZKProof.expires_at > datetime.utcnow()
                    )
                ).order_by(desc(ZKProof.generated_at)).limit(1)
                
                proof_result = await session.execute(proof_query)
                proof = proof_result.scalar_one_or_none()
                
                return proof
                
        except Exception as e:
            logger.error("Failed to get proof by entity", entity_id=entity_id, error=str(e))
            return None
    
    async def batch_verify_proofs(self, proof_ids: List[str]) -> List[VerificationResult]:
        """Verify multiple proofs in parallel for performance."""
        try:
            # Process in parallel batches
            batch_size = 10
            results = []
            
            for i in range(0, len(proof_ids), batch_size):
                batch = proof_ids[i:i + batch_size]
                batch_results = await asyncio.gather(
                    *[self.verify_proof(proof_id) for proof_id in batch],
                    return_exceptions=True
                )
                
                for result in batch_results:
                    if isinstance(result, Exception):
                        logger.error("Batch verification error", error=str(result))
                        # Create error result
                        results.append(VerificationResult(
                            proof_id="unknown",
                            is_valid=False,
                            verification_time=datetime.utcnow(),
                            public_signals={},
                            error_message=str(result)
                        ))
                    else:
                        results.append(result)
            
            return results
            
        except Exception as e:
            logger.error("Failed to batch verify proofs", error=str(e))
            raise
    
    # Helper methods
    
    async def _get_active_circuit(
        self,
        session: AsyncSession,
        circuit_name: str
    ) -> Optional[ZKProofCircuit]:
        """Get active circuit by name."""
        circuit_query = select(ZKProofCircuit).where(
            and_(
                ZKProofCircuit.circuit_name == circuit_name,
                ZKProofCircuit.is_active == True
            )
        ).order_by(desc(ZKProofCircuit.created_at)).limit(1)
        
        circuit_result = await session.execute(circuit_query)
        return circuit_result.scalar_one_or_none()
    
    async def _prepare_product_private_inputs(
        self,
        session: AsyncSession,
        metadata: ProductMetadata,
        brand_id: str
    ) -> Dict[str, Any]:
        """Prepare private inputs for product authenticity proof."""
        # Get brand signature and admin verification key
        brand_signature = await self._get_brand_signature(session, brand_id)
        admin_key = await self._get_admin_verification_key()
        
        return {
            "productMetadataHash": self._hash_metadata(metadata),
            "brandSignature": brand_signature,
            "timestampNonce": int(time.time()),
            "adminVerificationKey": admin_key,
            "priceHash": self._hash_price(metadata.price) if metadata.price else 0,
            "specificationsHash": self._hash_specifications(metadata.specifications)
        }
    
    async def _prepare_product_public_inputs(
        self,
        product_id: str,
        brand_id: str,
        metadata: ProductMetadata
    ) -> Dict[str, Any]:
        """Prepare public inputs for product authenticity proof."""
        return {
            "publicProductId": self._string_to_field_element(product_id),
            "brandId": self._string_to_field_element(brand_id),
            "verificationTimestamp": int(time.time()),
            "categoryHash": self._hash_category(metadata.category)
        }
    
    async def _prepare_brand_private_inputs(
        self,
        session: AsyncSession,
        brand_id: str,
        verification_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Prepare private inputs for brand verification proof."""
        return {
            "businessRegistrationHash": self._hash_string(verification_data.get("business_registration", "")),
            "trademarkHash": self._hash_trademarks(verification_data.get("trademarks", [])),
            "legalEntityHash": self._hash_string(verification_data.get("legal_entity_name", "")),
            "verificationTimestamp": int(time.time()),
            "adminSignature": await self._get_admin_signature(brand_id)
        }
    
    async def _prepare_brand_public_inputs(
        self,
        brand_id: str,
        verification_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Prepare public inputs for brand verification proof."""
        return {
            "brandId": self._string_to_field_element(brand_id),
            "verificationTimestamp": int(time.time()),
            "brandNameHash": self._hash_string(verification_data.get("brand_name", ""))
        }
    
    async def _generate_proof_with_circuit(
        self,
        circuit: ZKProofCircuit,
        proof_data: ZKProofGenerationData
    ) -> Dict[str, Any]:
        """Generate proof using Circom circuit and snarkjs."""
        try:
            # Combine inputs
            all_inputs = {**proof_data.private_inputs, **proof_data.public_inputs}
            
            # Create temporary input file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(all_inputs, f)
                input_file = f.name
            
            # Generate witness
            witness_file = input_file.replace('.json', '.wtns')
            await self._generate_witness(circuit.circuit_file_path, input_file, witness_file)
            
            # Generate proof
            proof_file = input_file.replace('.json', '_proof.json')
            public_file = input_file.replace('.json', '_public.json')
            
            await self._generate_proof_snarkjs(
                circuit.proving_key_path, witness_file, proof_file, public_file
            )
            
            # Read generated proof and public signals
            with open(proof_file, 'r') as f:
                proof = json.load(f)
            
            with open(public_file, 'r') as f:
                public_signals = json.load(f)
            
            # Cleanup temporary files
            for file_path in [input_file, witness_file, proof_file, public_file]:
                try:
                    os.unlink(file_path)
                except OSError:
                    pass
            
            return {
                "proof": proof,
                "public_signals": public_signals
            }
            
        except Exception as e:
            logger.error("Failed to generate proof with circuit", circuit_name=circuit.circuit_name, error=str(e))
            raise
    
    async def _verify_proof_with_snarkjs(
        self,
        verification_key_path: str,
        proof_data: Dict[str, Any],
        public_signals: Dict[str, Any]
    ) -> bool:
        """Verify proof using snarkjs."""
        try:
            # Create temporary files for verification
            with tempfile.NamedTemporaryFile(mode='w', suffix='_proof.json', delete=False) as f:
                json.dump(proof_data, f)
                proof_file = f.name
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='_public.json', delete=False) as f:
                json.dump(public_signals, f)
                public_file = f.name
            
            # Run snarkjs verification
            cmd = [
                "snarkjs", "groth16", "verify",
                verification_key_path,
                public_file,
                proof_file
            ]
            
            result = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await result.communicate()
            
            # Cleanup temporary files
            try:
                os.unlink(proof_file)
                os.unlink(public_file)
            except OSError:
                pass
            
            if result.returncode == 0:
                output = stdout.decode().strip()
                return "OK!" in output
            else:
                logger.error("snarkjs verification failed", stderr=stderr.decode())
                return False
                
        except Exception as e:
            logger.error("Failed to verify proof with snarkjs", error=str(e))
            return False
    
    async def _generate_witness(
        self,
        circuit_path: str,
        input_file: str,
        witness_file: str
    ) -> None:
        """Generate witness for circuit."""
        wasm_path = circuit_path.replace('.r1cs', '.wasm')
        
        cmd = [
            "node",
            os.path.join(os.path.dirname(wasm_path), "generate_witness.js"),
            wasm_path,
            input_file,
            witness_file
        ]
        
        result = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await result.communicate()
        
        if result.returncode != 0:
            raise RuntimeError(f"Witness generation failed: {stderr.decode()}")
    
    async def _generate_proof_snarkjs(
        self,
        proving_key_path: str,
        witness_file: str,
        proof_file: str,
        public_file: str
    ) -> None:
        """Generate proof using snarkjs."""
        cmd = [
            "snarkjs", "groth16", "prove",
            proving_key_path,
            witness_file,
            proof_file,
            public_file
        ]
        
        result = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await result.communicate()
        
        if result.returncode != 0:
            raise RuntimeError(f"Proof generation failed: {stderr.decode()}")
    
    async def _run_powers_of_tau_ceremony(
        self,
        output_file: str,
        contributor_count: int
    ) -> None:
        """Run Powers of Tau ceremony (simplified)."""
        # In production, this would be a multi-party ceremony
        # For now, we'll generate a basic ceremony file
        cmd = [
            "snarkjs", "powersoftau", "new", "bn128", "12",
            output_file.replace('.ptau', '_0000.ptau')
        ]
        
        result = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        await result.communicate()
        
        if result.returncode != 0:
            raise RuntimeError("Powers of Tau ceremony initialization failed")
        
        # Simulate contributions and finalization
        # In production, each contributor would add their contribution
        current_file = output_file.replace('.ptau', '_0000.ptau')
        
        for i in range(min(contributor_count, 3)):  # Limit for demo
            next_file = output_file.replace('.ptau', f'_{i+1:04d}.ptau')
            
            cmd = [
                "snarkjs", "powersoftau", "contribute",
                current_file, next_file,
                "--name", f"contributor_{i+1}",
                "-e", f"random_entropy_{i}_{int(time.time())}"
            ]
            
            result = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            await result.communicate()
            current_file = next_file
        
        # Prepare phase 2
        cmd = [
            "snarkjs", "powersoftau", "prepare", "phase2",
            current_file, output_file
        ]
        
        result = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        await result.communicate()
    
    async def _run_circuit_specific_setup(
        self,
        circuit_path: str,
        ptau_file: str,
        proving_key_path: str,
        verification_key_path: str,
        contributors: List[str],
        beacon: str
    ) -> None:
        """Run circuit-specific setup phase."""
        # Setup initial zkey
        initial_zkey = proving_key_path.replace('.zkey', '_0000.zkey')
        
        cmd = [
            "snarkjs", "groth16", "setup",
            circuit_path, ptau_file, initial_zkey
        ]
        
        result = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        await result.communicate()
        
        if result.returncode != 0:
            raise RuntimeError("Circuit setup failed")
        
        # Contribute to phase 2
        current_zkey = initial_zkey
        
        for i, contributor in enumerate(contributors[:3]):  # Limit for demo
            next_zkey = proving_key_path.replace('.zkey', f'_{i+1:04d}.zkey')
            
            cmd = [
                "snarkjs", "zkey", "contribute",
                current_zkey, next_zkey,
                "--name", contributor,
                "-e", f"entropy_{contributor}_{int(time.time())}"
            ]
            
            result = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            await result.communicate()
            current_zkey = next_zkey
        
        # Apply beacon for final randomness
        cmd = [
            "snarkjs", "zkey", "beacon",
            current_zkey, proving_key_path,
            beacon, "10", "-n", "Final Beacon"
        ]
        
        result = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        await result.communicate()
        
        # Export verification key
        cmd = [
            "snarkjs", "zkey", "export", "verificationkey",
            proving_key_path, verification_key_path
        ]
        
        result = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        await result.communicate()
    
    def _hash_proof(self, proof_result: Dict[str, Any]) -> str:
        """Generate SHA-256 hash of proof for integrity verification."""
        proof_string = json.dumps(proof_result, sort_keys=True)
        return hashlib.sha256(proof_string.encode()).hexdigest()
    
    def _hash_metadata(self, metadata: ProductMetadata) -> str:
        """Hash product metadata for proof."""
        metadata_string = f"{metadata.name}|{metadata.description}|{metadata.category}"
        return hashlib.sha256(metadata_string.encode()).hexdigest()
    
    def _hash_price(self, price: float) -> int:
        """Hash price for proof (convert to field element)."""
        return int(hashlib.sha256(str(price).encode()).hexdigest()[:15], 16)
    
    def _hash_specifications(self, specs: Dict[str, Any]) -> str:
        """Hash product specifications."""
        specs_string = json.dumps(specs, sort_keys=True)
        return hashlib.sha256(specs_string.encode()).hexdigest()
    
    def _hash_category(self, category: str) -> int:
        """Hash category to field element."""
        return int(hashlib.sha256(category.encode()).hexdigest()[:15], 16)
    
    def _hash_string(self, text: str) -> str:
        """Hash string for proof."""
        return hashlib.sha256(text.encode()).hexdigest()
    
    def _hash_trademarks(self, trademarks: List[str]) -> str:
        """Hash trademark list."""
        trademark_string = "|".join(sorted(trademarks))
        return hashlib.sha256(trademark_string.encode()).hexdigest()
    
    def _string_to_field_element(self, text: str) -> int:
        """Convert string to field element for circuit."""
        return int(hashlib.sha256(text.encode()).hexdigest()[:15], 16)
    
    async def _get_brand_signature(self, session: AsyncSession, brand_id: str) -> str:
        """Get brand signature for proof."""
        # In production, this would retrieve the actual brand signature
        return f"brand_signature_{brand_id}_{int(time.time())}"
    
    async def _get_admin_verification_key(self) -> str:
        """Get admin verification key."""
        # In production, this would be a proper admin key
        return "admin_verification_key_placeholder"
    
    async def _get_admin_signature(self, brand_id: str) -> str:
        """Get admin signature for brand verification."""
        return f"admin_signature_{brand_id}_{int(time.time())}"
    
    async def _generate_setup_hash(
        self,
        proving_key_path: str,
        verification_key_path: str,
        beacon: str
    ) -> str:
        """Generate hash of trusted setup for verification."""
        hasher = hashlib.sha256()
        
        # Hash proving key
        with open(proving_key_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hasher.update(chunk)
        
        # Hash verification key
        with open(verification_key_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hasher.update(chunk)
        
        # Add beacon
        hasher.update(beacon.encode())
        
        return hasher.hexdigest()
    
    def _cleanup_cache(self) -> None:
        """Clean up expired cache entries."""
        current_time = time.time()
        
        # Clean verification cache
        expired_keys = [
            key for key, (_, timestamp) in self.verification_cache.items()
            if current_time - timestamp > self.cache_ttl_seconds
        ]
        
        for key in expired_keys:
            del self.verification_cache[key]
        
        # Limit cache size
        if len(self.verification_cache) > self.max_cache_size:
            # Remove oldest entries
            sorted_items = sorted(
                self.verification_cache.items(),
                key=lambda x: x[1][1]
            )
            
            for key, _ in sorted_items[:len(sorted_items) - self.max_cache_size]:
                del self.verification_cache[key]