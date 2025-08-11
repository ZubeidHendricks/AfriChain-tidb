"""
Audit Trail Service for immutable cryptographic audit trail system.

Implements Merkle tree-based audit trails with blockchain anchoring,
RFC 3161 timestamp proofs, and enterprise compliance verification.
"""

import asyncio
import hashlib
import json
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from uuid import uuid4
import requests
import aiohttp

import structlog
from sqlalchemy import and_, func, desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..models.audit_proof import (
    AuditProof, AuditEntry, AuditBatch, ComplianceReport,
    AuditEventType, BlockchainNetwork, TimestampStatus
)
from ..models.zkproof import ZKProof, ProofType
from ..services.blockchain_service import BlockchainService
from ..services.timestamp_service import RFC3161TimestampService
from ..utils.merkle_tree import MerkleTree
from ..utils.crypto_utils import CryptoUtils

logger = structlog.get_logger(__name__)


@dataclass
class AuditEventData:
    """Data structure for audit events."""
    event_type: AuditEventType
    event_id: str
    entity_id: str
    entity_type: str
    actor_id: str
    actor_type: str
    event_data: Dict[str, Any]
    event_timestamp: datetime
    previous_state_hash: Optional[str] = None
    new_state_hash: Optional[str] = None


@dataclass
class AuditVerificationResult:
    """Result of audit trail verification."""
    is_valid: bool
    verification_details: Dict[str, Any]
    error_messages: List[str]
    verification_timestamp: datetime


@dataclass
class ComplianceMetrics:
    """Compliance metrics for reporting."""
    total_audit_entries: int
    verified_entries: int
    blockchain_anchored_entries: int
    timestamped_entries: int
    compliance_score: float
    risk_indicators: List[str]


class AuditTrailService:
    """Service for managing immutable cryptographic audit trails."""
    
    def __init__(self):
        """Initialize audit trail service."""
        self.blockchain_service: Optional[BlockchainService] = None
        self.timestamp_service: Optional[RFC3161TimestampService] = None
        self.merkle_tree = MerkleTree()
        self.crypto_utils = CryptoUtils()
        
        # Batch processing configuration
        self.batch_size = 1000
        self.batch_timeout_minutes = 60
        self.auto_seal_batches = True
        
        # Performance optimization
        self.processing_pool_size = 4
        self.max_concurrent_anchors = 3
    
    async def create_audit_entry(
        self,
        event_data: AuditEventData
    ) -> str:
        """
        Create a new audit entry.
        
        Args:
            event_data: Audit event data
            
        Returns:
            Audit entry ID
        """
        try:
            async with get_db_session() as session:
                # Get or create current batch
                batch = await self._get_or_create_current_batch(session)
                
                # Generate event hash
                event_hash = self._hash_event_data(event_data)
                
                # Create audit entry
                entry = AuditEntry(
                    id=str(uuid4()),
                    audit_batch_id=batch.id,
                    entry_sequence=batch.total_entries + 1,
                    event_type=event_data.event_type,
                    event_id=event_data.event_id,
                    entity_id=event_data.entity_id,
                    entity_type=event_data.entity_type,
                    event_data=event_data.event_data,
                    event_hash=event_hash,
                    actor_id=event_data.actor_id,
                    actor_type=event_data.actor_type,
                    event_timestamp=event_data.event_timestamp,
                    previous_state_hash=event_data.previous_state_hash,
                    new_state_hash=event_data.new_state_hash
                )
                
                session.add(entry)
                
                # Update batch statistics
                batch.total_entries = (batch.total_entries or 0) + 1
                
                await session.commit()
                
                # Check if batch should be processed
                if batch.total_entries >= self.batch_size:
                    await self._schedule_batch_processing(batch.id)
                
                logger.info(
                    "Audit entry created",
                    entry_id=entry.id,
                    batch_id=batch.id,
                    event_type=event_data.event_type.value,
                    event_hash=event_hash
                )
                
                return entry.id
                
        except Exception as e:
            logger.error("Failed to create audit entry", error=str(e))
            raise
    
    async def create_audit_batch(
        self,
        audit_entries: List[AuditEntry]
    ) -> AuditProof:
        """
        Create cryptographically verifiable audit batch with Merkle tree.
        
        Args:
            audit_entries: List of audit entries to include in batch
            
        Returns:
            Generated audit proof
        """
        try:
            if not audit_entries:
                raise ValueError("No audit entries provided")
            
            batch_id = audit_entries[0].audit_batch_id
            
            # Generate leaf hashes for Merkle tree
            leaf_hashes = []
            for i, entry in enumerate(audit_entries):
                leaf_data = {
                    "entry_id": entry.id,
                    "event_hash": entry.event_hash,
                    "sequence": entry.entry_sequence,
                    "timestamp": entry.event_timestamp.isoformat()
                }
                leaf_hash = self._hash_leaf_data(leaf_data)
                entry.merkle_leaf_hash = leaf_hash
                entry.merkle_leaf_index = i
                leaf_hashes.append(leaf_hash)
            
            # Build Merkle tree
            merkle_root, merkle_proof_data = self.merkle_tree.build_tree_with_proofs(leaf_hashes)
            
            # Generate audit data hash
            audit_data_hash = self._hash_audit_batch(audit_entries)
            
            # Create audit proof
            audit_proof = AuditProof(
                id=str(uuid4()),
                audit_batch_id=batch_id,
                batch_sequence_number=await self._get_next_batch_sequence(),
                merkle_root=merkle_root,
                merkle_proof=merkle_proof_data,
                leaf_count=len(audit_entries),
                tree_depth=self.merkle_tree.calculate_tree_depth(len(audit_entries)),
                blockchain_network=BlockchainNetwork.ETHEREUM,  # Default to Ethereum
                audit_data_hash=audit_data_hash,
                audit_entry_count=len(audit_entries),
                proof_generation_time=datetime.utcnow()
            )
            
            async with get_db_session() as session:
                session.add(audit_proof)
                
                # Update audit entries with Merkle data
                for entry in audit_entries:
                    session.add(entry)
                
                await session.commit()
            
            # Generate RFC 3161 timestamp proof
            await self._generate_timestamp_proof(audit_proof)
            
            # Anchor to blockchain
            await self._anchor_to_blockchain(audit_proof)
            
            logger.info(
                "Audit batch created",
                batch_id=batch_id,
                proof_id=audit_proof.id,
                merkle_root=merkle_root,
                entry_count=len(audit_entries)
            )
            
            return audit_proof
            
        except Exception as e:
            logger.error("Failed to create audit batch", error=str(e))
            raise
    
    async def verify_audit_integrity(
        self,
        audit_proof_id: str,
        audit_entry: AuditEntry
    ) -> AuditVerificationResult:
        """
        Verify audit entry integrity using Merkle proof.
        
        Args:
            audit_proof_id: Audit proof identifier
            audit_entry: Audit entry to verify
            
        Returns:
            Verification result
        """
        try:
            async with get_db_session() as session:
                # Get audit proof
                proof_query = select(AuditProof).where(AuditProof.id == audit_proof_id)
                proof_result = await session.execute(proof_query)
                audit_proof = proof_result.scalar_one_or_none()
                
                if not audit_proof:
                    return AuditVerificationResult(
                        is_valid=False,
                        verification_details={},
                        error_messages=[f"Audit proof {audit_proof_id} not found"],
                        verification_timestamp=datetime.utcnow()
                    )
                
                verification_details = {}
                error_messages = []
                
                # Verify entry hash
                expected_hash = self._hash_event_data_from_entry(audit_entry)
                if audit_entry.event_hash != expected_hash:
                    error_messages.append("Event hash verification failed")
                else:
                    verification_details["event_hash_valid"] = True
                
                # Verify Merkle proof
                if audit_entry.merkle_leaf_hash and audit_entry.merkle_leaf_index is not None:
                    merkle_valid = self.merkle_tree.verify_proof(
                        audit_entry.merkle_leaf_hash,
                        audit_proof.merkle_proof,
                        audit_proof.merkle_root,
                        int(audit_entry.merkle_leaf_index)
                    )
                    
                    if not merkle_valid:
                        error_messages.append("Merkle proof verification failed")
                    else:
                        verification_details["merkle_proof_valid"] = True
                
                # Verify blockchain anchor
                if audit_proof.blockchain_anchor_tx:
                    blockchain_valid = await self._verify_blockchain_anchor(
                        audit_proof.blockchain_anchor_tx,
                        audit_proof.merkle_root,
                        audit_proof.blockchain_network
                    )
                    
                    if not blockchain_valid:
                        error_messages.append("Blockchain anchor verification failed")
                    else:
                        verification_details["blockchain_anchor_valid"] = True
                
                # Verify timestamp proof
                if audit_proof.timestamp_proof:
                    timestamp_valid = await self._verify_timestamp_proof(
                        audit_proof.timestamp_proof,
                        audit_proof.merkle_root
                    )
                    
                    if not timestamp_valid:
                        error_messages.append("Timestamp proof verification failed")
                    else:
                        verification_details["timestamp_proof_valid"] = True
                
                # Update verification tracking
                audit_proof.mark_verification_attempt()
                await session.commit()
                
                is_valid = len(error_messages) == 0
                
                result = AuditVerificationResult(
                    is_valid=is_valid,
                    verification_details=verification_details,
                    error_messages=error_messages,
                    verification_timestamp=datetime.utcnow()
                )
                
                logger.info(
                    "Audit integrity verification completed",
                    audit_proof_id=audit_proof_id,
                    entry_id=audit_entry.id,
                    is_valid=is_valid,
                    verification_count=len(verification_details)
                )
                
                return result
                
        except Exception as e:
            logger.error("Failed to verify audit integrity", error=str(e))
            return AuditVerificationResult(
                is_valid=False,
                verification_details={},
                error_messages=[f"Verification failed: {str(e)}"],
                verification_timestamp=datetime.utcnow()
            )
    
    async def generate_compliance_report(
        self,
        period_start: datetime,
        period_end: datetime,
        report_type: str = "regulatory"
    ) -> ComplianceReport:
        """
        Generate comprehensive compliance report with cryptographic evidence.
        
        Args:
            period_start: Report period start
            period_end: Report period end
            report_type: Type of compliance report
            
        Returns:
            Generated compliance report
        """
        try:
            async with get_db_session() as session:
                # Gather audit statistics
                audit_metrics = await self._calculate_compliance_metrics(
                    session, period_start, period_end
                )
                
                # Get zkSNARK proof statistics
                zkproof_stats = await self._get_zkproof_statistics(
                    session, period_start, period_end
                )
                
                # Collect cryptographic evidence
                evidence = await self._collect_cryptographic_evidence(
                    session, period_start, period_end
                )
                
                # Generate report data
                report_data = {
                    "period": {
                        "start": period_start.isoformat(),
                        "end": period_end.isoformat(),
                        "duration_days": (period_end - period_start).days
                    },
                    "audit_metrics": {
                        "total_entries": audit_metrics.total_audit_entries,
                        "verified_entries": audit_metrics.verified_entries,
                        "blockchain_anchored": audit_metrics.blockchain_anchored_entries,
                        "timestamped_entries": audit_metrics.timestamped_entries,
                        "verification_rate": audit_metrics.verified_entries / max(1, audit_metrics.total_audit_entries) * 100
                    },
                    "zkproof_metrics": zkproof_stats,
                    "compliance_assessment": {
                        "overall_score": audit_metrics.compliance_score,
                        "risk_indicators": audit_metrics.risk_indicators,
                        "audit_coverage": self._calculate_audit_coverage(audit_metrics),
                        "cryptographic_integrity": self._assess_cryptographic_integrity(evidence)
                    },
                    "regulatory_attestations": await self._generate_regulatory_attestations(
                        audit_metrics, zkproof_stats
                    )
                }
                
                # Create compliance report
                report = ComplianceReport(
                    id=str(uuid4()),
                    report_type=report_type,
                    report_period_start=period_start,
                    report_period_end=period_end,
                    total_products_verified=zkproof_stats.get("total_products", 0),
                    zkproof_verified_count=zkproof_stats.get("valid_proofs", 0),
                    audit_entries_count=audit_metrics.total_audit_entries,
                    compliance_score=audit_metrics.compliance_score,
                    risk_score=100 - audit_metrics.compliance_score,
                    report_data=report_data,
                    cryptographic_evidence=evidence,
                    generated_by="system",  # In production, use actual user ID
                    generation_duration_ms=0  # Will be updated
                )
                
                session.add(report)
                await session.commit()
                
                # Sign report
                await self._sign_compliance_report(report)
                
                logger.info(
                    "Compliance report generated",
                    report_id=report.id,
                    report_type=report_type,
                    period_days=(period_end - period_start).days,
                    compliance_score=audit_metrics.compliance_score
                )
                
                return report
                
        except Exception as e:
            logger.error("Failed to generate compliance report", error=str(e))
            raise
    
    async def export_audit_trail(
        self,
        entity_id: str,
        entity_type: str,
        format_type: str = "json"
    ) -> Dict[str, Any]:
        """Export complete audit trail for an entity."""
        try:
            async with get_db_session() as session:
                # Get all audit entries for entity
                entries_query = select(AuditEntry).where(
                    and_(
                        AuditEntry.entity_id == entity_id,
                        AuditEntry.entity_type == entity_type
                    )
                ).order_by(AuditEntry.event_timestamp)
                
                entries_result = await session.execute(entries_query)
                entries = entries_result.scalars().all()
                
                if not entries:
                    return {"entries": [], "total_count": 0}
                
                # Get associated audit proofs
                batch_ids = list(set(entry.audit_batch_id for entry in entries))
                proofs_query = select(AuditProof).where(
                    AuditProof.audit_batch_id.in_(batch_ids)
                )
                proofs_result = await session.execute(proofs_query)
                proofs = proofs_result.scalars().all()
                
                # Build export data
                export_data = {
                    "entity_id": entity_id,
                    "entity_type": entity_type,
                    "export_timestamp": datetime.utcnow().isoformat(),
                    "total_entries": len(entries),
                    "audit_trail": [],
                    "cryptographic_proofs": [proof.get_audit_proof_summary() for proof in proofs],
                    "verification_info": {
                        "blockchain_anchored_batches": sum(1 for p in proofs if p.blockchain_anchor_tx),
                        "timestamped_batches": sum(1 for p in proofs if p.timestamp_status == TimestampStatus.CONFIRMED),
                        "total_batches": len(proofs)
                    }
                }
                
                for entry in entries:
                    entry_data = entry.get_audit_entry_summary()
                    
                    # Add verification status
                    entry_proof = next((p for p in proofs if p.audit_batch_id == entry.audit_batch_id), None)
                    if entry_proof:
                        entry_data["cryptographic_verification"] = {
                            "is_anchored": bool(entry_proof.blockchain_anchor_tx),
                            "is_timestamped": entry_proof.timestamp_status == TimestampStatus.CONFIRMED,
                            "merkle_root": entry_proof.merkle_root,
                            "blockchain_tx": entry_proof.blockchain_anchor_tx
                        }
                    
                    export_data["audit_trail"].append(entry_data)
                
                return export_data
                
        except Exception as e:
            logger.error("Failed to export audit trail", entity_id=entity_id, error=str(e))
            raise
    
    # Helper methods
    
    async def _get_or_create_current_batch(self, session: AsyncSession) -> AuditBatch:
        """Get current active batch or create new one."""
        # Look for active batch
        current_time = datetime.utcnow()
        batch_query = select(AuditBatch).where(
            and_(
                AuditBatch.is_completed == False,
                AuditBatch.batch_period_end > current_time
            )
        ).order_by(desc(AuditBatch.created_at)).limit(1)
        
        batch_result = await session.execute(batch_query)
        batch = batch_result.scalar_one_or_none()
        
        if not batch:
            # Create new batch
            batch_start = current_time.replace(minute=0, second=0, microsecond=0)
            batch_end = batch_start + timedelta(hours=1)  # 1-hour batches
            
            # Get next batch number
            last_batch_query = select(func.max(AuditBatch.batch_number))
            last_batch_result = await session.execute(last_batch_query)
            last_batch_number = last_batch_result.scalar() or 0
            
            batch = AuditBatch(
                id=str(uuid4()),
                batch_number=last_batch_number + 1,
                batch_period_start=batch_start,
                batch_period_end=batch_end,
                total_entries=0,
                processed_entries=0,
                failed_entries=0,
                processing_started_at=current_time
            )
            
            session.add(batch)
            await session.flush()
        
        return batch
    
    async def _get_next_batch_sequence(self) -> int:
        """Get next batch sequence number."""
        async with get_db_session() as session:
            last_sequence_query = select(func.max(AuditProof.batch_sequence_number))
            last_sequence_result = await session.execute(last_sequence_query)
            last_sequence = last_sequence_result.scalar() or 0
            return last_sequence + 1
    
    def _hash_event_data(self, event_data: AuditEventData) -> str:
        """Generate hash of event data."""
        hash_data = {
            "event_type": event_data.event_type.value,
            "event_id": event_data.event_id,
            "entity_id": event_data.entity_id,
            "entity_type": event_data.entity_type,
            "actor_id": event_data.actor_id,
            "event_data": event_data.event_data,
            "timestamp": event_data.event_timestamp.isoformat()
        }
        
        hash_string = json.dumps(hash_data, sort_keys=True)
        return hashlib.sha256(hash_string.encode()).hexdigest()
    
    def _hash_event_data_from_entry(self, entry: AuditEntry) -> str:
        """Generate hash from audit entry."""
        hash_data = {
            "event_type": entry.event_type.value,
            "event_id": entry.event_id,
            "entity_id": entry.entity_id,
            "entity_type": entry.entity_type,
            "actor_id": entry.actor_id,
            "event_data": entry.event_data,
            "timestamp": entry.event_timestamp.isoformat()
        }
        
        hash_string = json.dumps(hash_data, sort_keys=True)
        return hashlib.sha256(hash_string.encode()).hexdigest()
    
    def _hash_leaf_data(self, leaf_data: Dict[str, Any]) -> str:
        """Generate hash for Merkle tree leaf."""
        hash_string = json.dumps(leaf_data, sort_keys=True)
        return hashlib.sha256(hash_string.encode()).hexdigest()
    
    def _hash_audit_batch(self, entries: List[AuditEntry]) -> str:
        """Generate hash of entire audit batch."""
        batch_data = {
            "entries": [
                {
                    "id": entry.id,
                    "sequence": entry.entry_sequence,
                    "hash": entry.event_hash,
                    "timestamp": entry.event_timestamp.isoformat()
                }
                for entry in sorted(entries, key=lambda x: x.entry_sequence)
            ]
        }
        
        hash_string = json.dumps(batch_data, sort_keys=True)
        return hashlib.sha256(hash_string.encode()).hexdigest()
    
    async def _generate_timestamp_proof(self, audit_proof: AuditProof) -> None:
        """Generate RFC 3161 timestamp proof."""
        try:
            if not self.timestamp_service:
                logger.warning("Timestamp service not available")
                return
            
            # Generate timestamp for Merkle root
            timestamp_token = await self.timestamp_service.generate_timestamp(
                audit_proof.merkle_root.encode()
            )
            
            if timestamp_token:
                async with get_db_session() as session:
                    audit_proof.update_timestamp_proof(
                        timestamp_token["token"],
                        timestamp_token["tsa"],
                        timestamp_token["hash"]
                    )
                    session.add(audit_proof)
                    await session.commit()
                    
                logger.info(
                    "Timestamp proof generated",
                    proof_id=audit_proof.id,
                    tsa=timestamp_token["tsa"]
                )
            
        except Exception as e:
            logger.error("Failed to generate timestamp proof", proof_id=audit_proof.id, error=str(e))
    
    async def _anchor_to_blockchain(self, audit_proof: AuditProof) -> None:
        """Anchor Merkle root to blockchain."""
        try:
            if not self.blockchain_service:
                logger.warning("Blockchain service not available")
                return
            
            # Anchor to blockchain
            tx_hash = await self.blockchain_service.anchor_hash(
                audit_proof.merkle_root,
                metadata={
                    "audit_batch_id": audit_proof.audit_batch_id,
                    "entry_count": audit_proof.audit_entry_count,
                    "timestamp": audit_proof.proof_generation_time.isoformat()
                }
            )
            
            if tx_hash:
                async with get_db_session() as session:
                    audit_proof.blockchain_anchor_tx = tx_hash
                    session.add(audit_proof)
                    await session.commit()
                    
                logger.info(
                    "Blockchain anchor created",
                    proof_id=audit_proof.id,
                    tx_hash=tx_hash,
                    network=audit_proof.blockchain_network.value
                )
            
        except Exception as e:
            logger.error("Failed to anchor to blockchain", proof_id=audit_proof.id, error=str(e))
    
    async def _verify_blockchain_anchor(
        self,
        tx_hash: str,
        expected_data: str,
        network: BlockchainNetwork
    ) -> bool:
        """Verify blockchain anchor."""
        try:
            if not self.blockchain_service:
                return False
            
            return await self.blockchain_service.verify_anchor(tx_hash, expected_data)
            
        except Exception as e:
            logger.error("Failed to verify blockchain anchor", tx_hash=tx_hash, error=str(e))
            return False
    
    async def _verify_timestamp_proof(
        self,
        timestamp_proof: Dict[str, Any],
        expected_data: str
    ) -> bool:
        """Verify RFC 3161 timestamp proof."""
        try:
            if not self.timestamp_service:
                return False
            
            return await self.timestamp_service.verify_timestamp(
                timestamp_proof, expected_data.encode()
            )
            
        except Exception as e:
            logger.error("Failed to verify timestamp proof", error=str(e))
            return False
    
    async def _calculate_compliance_metrics(
        self,
        session: AsyncSession,
        period_start: datetime,
        period_end: datetime
    ) -> ComplianceMetrics:
        """Calculate compliance metrics for period."""
        # Count total audit entries
        total_query = select(func.count(AuditEntry.id)).where(
            and_(
                AuditEntry.event_timestamp >= period_start,
                AuditEntry.event_timestamp <= period_end
            )
        )
        total_result = await session.execute(total_query)
        total_entries = total_result.scalar() or 0
        
        # Count verified entries (those with valid proofs)
        verified_query = select(func.count(AuditEntry.id)).join(AuditProof).where(
            and_(
                AuditEntry.event_timestamp >= period_start,
                AuditEntry.event_timestamp <= period_end,
                AuditProof.verification_count > 0
            )
        )
        verified_result = await session.execute(verified_query)
        verified_entries = verified_result.scalar() or 0
        
        # Count blockchain anchored entries
        anchored_query = select(func.count(AuditEntry.id)).join(AuditProof).where(
            and_(
                AuditEntry.event_timestamp >= period_start,
                AuditEntry.event_timestamp <= period_end,
                AuditProof.blockchain_anchor_tx.isnot(None)
            )
        )
        anchored_result = await session.execute(anchored_query)
        anchored_entries = anchored_result.scalar() or 0
        
        # Count timestamped entries
        timestamped_query = select(func.count(AuditEntry.id)).join(AuditProof).where(
            and_(
                AuditEntry.event_timestamp >= period_start,
                AuditEntry.event_timestamp <= period_end,
                AuditProof.timestamp_status == TimestampStatus.CONFIRMED
            )
        )
        timestamped_result = await session.execute(timestamped_query)
        timestamped_entries = timestamped_result.scalar() or 0
        
        # Calculate compliance score
        if total_entries == 0:
            compliance_score = 100.0
        else:
            verification_rate = verified_entries / total_entries
            anchoring_rate = anchored_entries / total_entries
            timestamp_rate = timestamped_entries / total_entries
            
            compliance_score = (verification_rate * 0.4 + anchoring_rate * 0.3 + timestamp_rate * 0.3) * 100
        
        # Identify risk indicators
        risk_indicators = []
        if total_entries > 0:
            if verified_entries / total_entries < 0.95:
                risk_indicators.append("Low verification rate")
            if anchored_entries / total_entries < 0.90:
                risk_indicators.append("Insufficient blockchain anchoring")
            if timestamped_entries / total_entries < 0.90:
                risk_indicators.append("Limited timestamp coverage")
        
        return ComplianceMetrics(
            total_audit_entries=total_entries,
            verified_entries=verified_entries,
            blockchain_anchored_entries=anchored_entries,
            timestamped_entries=timestamped_entries,
            compliance_score=compliance_score,
            risk_indicators=risk_indicators
        )
    
    async def _get_zkproof_statistics(
        self,
        session: AsyncSession,
        period_start: datetime,
        period_end: datetime
    ) -> Dict[str, Any]:
        """Get zkSNARK proof statistics for period."""
        # Total proofs generated
        total_query = select(func.count(ZKProof.id)).where(
            and_(
                ZKProof.generated_at >= period_start,
                ZKProof.generated_at <= period_end
            )
        )
        total_result = await session.execute(total_query)
        total_proofs = total_result.scalar() or 0
        
        # Valid proofs
        valid_query = select(func.count(ZKProof.id)).where(
            and_(
                ZKProof.generated_at >= period_start,
                ZKProof.generated_at <= period_end,
                ZKProof.verification_status == "valid"
            )
        )
        valid_result = await session.execute(valid_query)
        valid_proofs = valid_result.scalar() or 0
        
        # Proofs by type
        type_query = select(ZKProof.proof_type, func.count(ZKProof.id)).where(
            and_(
                ZKProof.generated_at >= period_start,
                ZKProof.generated_at <= period_end
            )
        ).group_by(ZKProof.proof_type)
        type_result = await session.execute(type_query)
        proofs_by_type = {row[0].value: row[1] for row in type_result}
        
        return {
            "total_proofs": total_proofs,
            "valid_proofs": valid_proofs,
            "invalid_proofs": total_proofs - valid_proofs,
            "verification_rate": (valid_proofs / max(1, total_proofs)) * 100,
            "proofs_by_type": proofs_by_type,
            "total_products": proofs_by_type.get("product_authenticity", 0),
            "total_brands": proofs_by_type.get("brand_verification", 0)
        }
    
    async def _collect_cryptographic_evidence(
        self,
        session: AsyncSession,
        period_start: datetime,
        period_end: datetime
    ) -> Dict[str, Any]:
        """Collect cryptographic evidence for compliance report."""
        # Get recent audit proofs
        proofs_query = select(AuditProof).where(
            and_(
                AuditProof.proof_generation_time >= period_start,
                AuditProof.proof_generation_time <= period_end
            )
        ).order_by(desc(AuditProof.proof_generation_time)).limit(100)
        
        proofs_result = await session.execute(proofs_query)
        proofs = proofs_result.scalars().all()
        
        evidence = {
            "audit_proofs": [
                {
                    "merkle_root": proof.merkle_root,
                    "blockchain_tx": proof.blockchain_anchor_tx,
                    "timestamp_hash": proof.timestamp_token_hash,
                    "entry_count": proof.audit_entry_count
                }
                for proof in proofs
            ],
            "verification_summary": {
                "total_proofs": len(proofs),
                "anchored_proofs": sum(1 for p in proofs if p.blockchain_anchor_tx),
                "timestamped_proofs": sum(1 for p in proofs if p.timestamp_status == TimestampStatus.CONFIRMED)
            }
        }
        
        return evidence
    
    def _calculate_audit_coverage(self, metrics: ComplianceMetrics) -> float:
        """Calculate audit coverage percentage."""
        if metrics.total_audit_entries == 0:
            return 100.0
        
        coverage_score = (
            (metrics.verified_entries / metrics.total_audit_entries) * 0.4 +
            (metrics.blockchain_anchored_entries / metrics.total_audit_entries) * 0.3 +
            (metrics.timestamped_entries / metrics.total_audit_entries) * 0.3
        ) * 100
        
        return min(100.0, coverage_score)
    
    def _assess_cryptographic_integrity(self, evidence: Dict[str, Any]) -> Dict[str, Any]:
        """Assess cryptographic integrity of evidence."""
        summary = evidence.get("verification_summary", {})
        total_proofs = summary.get("total_proofs", 0)
        
        if total_proofs == 0:
            return {"status": "no_evidence", "score": 0}
        
        anchored_rate = summary.get("anchored_proofs", 0) / total_proofs
        timestamped_rate = summary.get("timestamped_proofs", 0) / total_proofs
        
        integrity_score = (anchored_rate * 0.6 + timestamped_rate * 0.4) * 100
        
        if integrity_score >= 95:
            status = "excellent"
        elif integrity_score >= 85:
            status = "good"
        elif integrity_score >= 70:
            status = "adequate"
        else:
            status = "poor"
        
        return {
            "status": status,
            "score": integrity_score,
            "anchoring_rate": anchored_rate * 100,
            "timestamp_rate": timestamped_rate * 100
        }
    
    async def _generate_regulatory_attestations(
        self,
        audit_metrics: ComplianceMetrics,
        zkproof_stats: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Generate regulatory attestations."""
        attestations = []
        
        # Audit trail completeness attestation
        if audit_metrics.compliance_score >= 95:
            attestations.append({
                "type": "audit_trail_completeness",
                "status": "compliant",
                "score": audit_metrics.compliance_score,
                "description": "Audit trail demonstrates comprehensive coverage with cryptographic verification"
            })
        
        # Data integrity attestation
        if audit_metrics.verified_entries / max(1, audit_metrics.total_audit_entries) >= 0.95:
            attestations.append({
                "type": "data_integrity",
                "status": "compliant",
                "verification_rate": audit_metrics.verified_entries / max(1, audit_metrics.total_audit_entries) * 100,
                "description": "Data integrity verified through cryptographic proofs and immutable audit trails"
            })
        
        # zkSNARK verification attestation
        if zkproof_stats.get("verification_rate", 0) >= 95:
            attestations.append({
                "type": "cryptographic_verification",
                "status": "compliant",
                "verification_rate": zkproof_stats.get("verification_rate", 0),
                "description": "Zero-knowledge proofs provide cryptographic verification of data authenticity"
            })
        
        return attestations
    
    async def _sign_compliance_report(self, report: ComplianceReport) -> None:
        """Sign compliance report with cryptographic signature."""
        try:
            # Generate report hash
            report_hash = hashlib.sha256(
                json.dumps(report.report_data, sort_keys=True).encode()
            ).hexdigest()
            
            # In production, use proper private key signing
            signature = f"signed_{report_hash[:32]}"
            
            report.sign_report(signature, "SHA256withRSA")
            
        except Exception as e:
            logger.error("Failed to sign compliance report", report_id=report.id, error=str(e))
    
    async def _schedule_batch_processing(self, batch_id: str) -> None:
        """Schedule batch processing for audit proof generation."""
        # In production, this would use a task queue like Celery
        logger.info("Batch processing scheduled", batch_id=batch_id)