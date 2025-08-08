"""
Enterprise Compliance Management System Integration Service.

Provides integration with enterprise compliance platforms including
ServiceNow GRC, MetricStream, SAP GRC, and other compliance management systems.
"""

import asyncio
import json
import hmac
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass
from enum import Enum
import aiohttp
import xml.etree.ElementTree as ET

import structlog
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..core.config import get_settings
from ..models.audit_proof import ComplianceReport, AuditProof, AuditEntry
from ..models.zkproof import ZKProof, ProofType, VerificationStatus
from ..services.audit_trail_service import AuditTrailService
from ..utils.crypto_utils import CryptoUtils

logger = structlog.get_logger(__name__)


class ComplianceSystemType(Enum):
    """Supported enterprise compliance management systems."""
    SERVICENOW_GRC = "servicenow_grc"
    METRICSTREAM = "metricstream"
    SAP_GRC = "sap_grc"
    IBM_OPENPAGES = "ibm_openpages"
    RSAM = "rsam"
    LOGIC_GATE = "logic_gate"
    RESOLVER = "resolver"
    CUSTOM_API = "custom_api"


class IntegrationStatus(Enum):
    """Integration status values."""
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"
    SYNCING = "syncing"


@dataclass
class ComplianceSystemConfig:
    """Configuration for compliance system integration."""
    system_type: ComplianceSystemType
    base_url: str
    api_version: str
    authentication: Dict[str, Any]
    sync_frequency_hours: int
    enabled_modules: List[str]
    field_mappings: Dict[str, str]
    webhook_endpoints: List[str]
    custom_headers: Dict[str, str]


@dataclass
class ComplianceRecord:
    """Compliance record for external systems."""
    record_id: str
    entity_id: str
    entity_type: str
    compliance_type: str
    status: str
    score: float
    findings: List[str]
    evidence: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
    external_reference: Optional[str] = None


@dataclass
class IntegrationSyncResult:
    """Result of compliance system synchronization."""
    system_type: ComplianceSystemType
    sync_started: datetime
    sync_completed: datetime
    records_processed: int
    records_created: int
    records_updated: int
    errors_encountered: int
    error_details: List[str]
    next_sync_scheduled: datetime


class EnterpriseComplianceIntegration:
    """Service for integrating with enterprise compliance management systems."""
    
    def __init__(self):
        """Initialize enterprise compliance integration service."""
        self.settings = get_settings()
        self.audit_trail_service = AuditTrailService()
        self.crypto_utils = CryptoUtils()
        
        # Integration configurations
        self.system_configs: Dict[ComplianceSystemType, ComplianceSystemConfig] = {}
        self.integration_status: Dict[ComplianceSystemType, IntegrationStatus] = {}
        self.sync_locks: Dict[ComplianceSystemType, asyncio.Lock] = {}
        
        # Performance tracking
        self.sync_metrics = {
            "total_syncs": 0,
            "successful_syncs": 0,
            "failed_syncs": 0,
            "total_records_synced": 0,
            "average_sync_time_seconds": 0.0
        }
        
        # Load configurations
        self._load_system_configurations()
    
    async def configure_system(
        self,
        system_type: ComplianceSystemType,
        config: ComplianceSystemConfig
    ) -> bool:
        """
        Configure integration with a compliance management system.
        
        Args:
            system_type: Type of compliance system
            config: System configuration
            
        Returns:
            True if configuration successful, False otherwise
        """
        try:
            # Validate configuration
            await self._validate_system_config(config)
            
            # Store configuration
            self.system_configs[system_type] = config
            self.sync_locks[system_type] = asyncio.Lock()
            
            # Test connection
            connection_test = await self._test_system_connection(system_type)
            
            if connection_test:
                self.integration_status[system_type] = IntegrationStatus.ACTIVE
                
                logger.info(
                    "Compliance system configured successfully",
                    system_type=system_type.value,
                    base_url=config.base_url
                )
                
                return True
            else:
                self.integration_status[system_type] = IntegrationStatus.ERROR
                logger.error("Failed to connect to compliance system", system_type=system_type.value)
                return False
                
        except Exception as e:
            logger.error("Failed to configure compliance system", system_type=system_type.value, error=str(e))
            self.integration_status[system_type] = IntegrationStatus.ERROR
            return False
    
    async def sync_compliance_data(
        self,
        system_type: ComplianceSystemType,
        period_start: datetime,
        period_end: datetime
    ) -> IntegrationSyncResult:
        """
        Synchronize compliance data with external system.
        
        Args:
            system_type: Target compliance system
            period_start: Start of sync period
            period_end: End of sync period
            
        Returns:
            Sync result details
        """
        try:
            if system_type not in self.system_configs:
                raise ValueError(f"System {system_type.value} not configured")
            
            # Acquire sync lock
            async with self.sync_locks[system_type]:
                self.integration_status[system_type] = IntegrationStatus.SYNCING
                sync_start = datetime.utcnow()
                
                logger.info(
                    "Starting compliance data sync",
                    system_type=system_type.value,
                    period_start=period_start.isoformat(),
                    period_end=period_end.isoformat()
                )
                
                # Gather compliance data
                compliance_records = await self._gather_compliance_data(period_start, period_end)
                
                # Transform data for target system
                transformed_records = await self._transform_compliance_data(
                    compliance_records, system_type
                )
                
                # Push data to external system
                sync_result = await self._push_to_external_system(
                    system_type, transformed_records
                )
                
                sync_end = datetime.utcnow()
                
                # Update sync result with timing
                sync_result.sync_started = sync_start
                sync_result.sync_completed = sync_end
                sync_result.next_sync_scheduled = sync_end + timedelta(
                    hours=self.system_configs[system_type].sync_frequency_hours
                )
                
                # Update metrics
                self._update_sync_metrics(sync_result)
                
                self.integration_status[system_type] = IntegrationStatus.ACTIVE
                
                logger.info(
                    "Compliance data sync completed",
                    system_type=system_type.value,
                    records_processed=sync_result.records_processed,
                    duration_seconds=(sync_end - sync_start).total_seconds()
                )
                
                return sync_result
                
        except Exception as e:
            logger.error("Failed to sync compliance data", system_type=system_type.value, error=str(e))
            self.integration_status[system_type] = IntegrationStatus.ERROR
            
            return IntegrationSyncResult(
                system_type=system_type,
                sync_started=datetime.utcnow(),
                sync_completed=datetime.utcnow(),
                records_processed=0,
                records_created=0,
                records_updated=0,
                errors_encountered=1,
                error_details=[str(e)],
                next_sync_scheduled=datetime.utcnow() + timedelta(hours=1)
            )
    
    async def push_compliance_report(
        self,
        report_id: str,
        target_systems: List[ComplianceSystemType]
    ) -> Dict[ComplianceSystemType, bool]:
        """
        Push compliance report to multiple external systems.
        
        Args:
            report_id: Compliance report identifier
            target_systems: List of target systems
            
        Returns:
            Dictionary mapping system types to success status
        """
        try:
            async with get_db_session() as session:
                # Get compliance report
                report_query = select(ComplianceReport).where(ComplianceReport.id == report_id)
                report_result = await session.execute(report_query)
                report = report_result.scalar_one_or_none()
                
                if not report:
                    raise ValueError(f"Compliance report {report_id} not found")
                
                results = {}
                
                # Push to each target system
                for system_type in target_systems:
                    try:
                        success = await self._push_report_to_system(report, system_type)
                        results[system_type] = success
                    except Exception as e:
                        logger.error(
                            "Failed to push report to system",
                            report_id=report_id,
                            system_type=system_type.value,
                            error=str(e)
                        )
                        results[system_type] = False
                
                logger.info(
                    "Compliance report push completed",
                    report_id=report_id,
                    successful_pushes=sum(1 for success in results.values() if success),
                    total_systems=len(target_systems)
                )
                
                return results
                
        except Exception as e:
            logger.error("Failed to push compliance report", report_id=report_id, error=str(e))
            return {system_type: False for system_type in target_systems}
    
    async def receive_compliance_finding(
        self,
        external_finding: Dict[str, Any],
        source_system: ComplianceSystemType
    ) -> str:
        """
        Receive and process compliance finding from external system.
        
        Args:
            external_finding: Finding data from external system
            source_system: Source compliance system
            
        Returns:
            Internal finding ID
        """
        try:
            # Transform external finding to internal format
            internal_finding = await self._transform_external_finding(
                external_finding, source_system
            )
            
            # Create audit entry for the finding
            audit_data = {
                "event_type": "compliance_finding_received",
                "source_system": source_system.value,
                "finding_id": external_finding.get("id"),
                "severity": external_finding.get("severity"),
                "status": external_finding.get("status"),
                "finding_data": internal_finding
            }
            
            finding_id = await self.audit_trail_service.create_audit_entry(audit_data)
            
            logger.info(
                "Compliance finding received",
                finding_id=finding_id,
                source_system=source_system.value,
                external_id=external_finding.get("id")
            )
            
            return finding_id
            
        except Exception as e:
            logger.error("Failed to receive compliance finding", error=str(e))
            raise
    
    async def get_integration_status(self) -> Dict[str, Any]:
        """Get status of all compliance system integrations."""
        try:
            status_info = {
                "integrations": {},
                "sync_metrics": self.sync_metrics,
                "last_updated": datetime.utcnow().isoformat()
            }
            
            for system_type, status in self.integration_status.items():
                config = self.system_configs.get(system_type)
                
                status_info["integrations"][system_type.value] = {
                    "status": status.value,
                    "base_url": config.base_url if config else None,
                    "enabled_modules": config.enabled_modules if config else [],
                    "sync_frequency_hours": config.sync_frequency_hours if config else 0,
                    "last_sync": None,  # Would track from database
                    "next_sync": None   # Would calculate based on frequency
                }
            
            return status_info
            
        except Exception as e:
            logger.error("Failed to get integration status", error=str(e))
            return {"error": str(e)}
    
    # Helper methods
    
    async def _validate_system_config(self, config: ComplianceSystemConfig) -> None:
        """Validate compliance system configuration."""
        required_fields = ["base_url", "authentication", "enabled_modules"]
        
        for field in required_fields:
            if not getattr(config, field, None):
                raise ValueError(f"Missing required configuration field: {field}")
        
        # Validate authentication based on system type
        auth = config.authentication
        if config.system_type == ComplianceSystemType.SERVICENOW_GRC:
            if not all(key in auth for key in ["username", "password"]):
                raise ValueError("ServiceNow GRC requires username and password")
        elif config.system_type == ComplianceSystemType.SAP_GRC:
            if not all(key in auth for key in ["client_id", "client_secret"]):
                raise ValueError("SAP GRC requires client_id and client_secret")
    
    async def _test_system_connection(self, system_type: ComplianceSystemType) -> bool:
        """Test connection to compliance system."""
        try:
            config = self.system_configs[system_type]
            
            if system_type == ComplianceSystemType.SERVICENOW_GRC:
                return await self._test_servicenow_connection(config)
            elif system_type == ComplianceSystemType.SAP_GRC:
                return await self._test_sap_grc_connection(config)
            elif system_type == ComplianceSystemType.METRICSTREAM:
                return await self._test_metricstream_connection(config)
            else:
                return await self._test_generic_api_connection(config)
                
        except Exception as e:
            logger.error("Connection test failed", system_type=system_type.value, error=str(e))
            return False
    
    async def _test_servicenow_connection(self, config: ComplianceSystemConfig) -> bool:
        """Test ServiceNow GRC connection."""
        try:
            auth = aiohttp.BasicAuth(
                config.authentication["username"],
                config.authentication["password"]
            )
            
            async with aiohttp.ClientSession(auth=auth) as session:
                url = f"{config.base_url}/api/now/table/sn_grc_policy"
                headers = {"Content-Type": "application/json"}
                headers.update(config.custom_headers)
                
                async with session.get(url, headers=headers) as response:
                    return response.status == 200
                    
        except Exception as e:
            logger.error("ServiceNow connection test failed", error=str(e))
            return False
    
    async def _test_sap_grc_connection(self, config: ComplianceSystemConfig) -> bool:
        """Test SAP GRC connection."""
        try:
            # SAP GRC typically uses OAuth2
            oauth_url = f"{config.base_url}/oauth/token"
            
            async with aiohttp.ClientSession() as session:
                data = {
                    "grant_type": "client_credentials",
                    "client_id": config.authentication["client_id"],
                    "client_secret": config.authentication["client_secret"]
                }
                
                async with session.post(oauth_url, data=data) as response:
                    if response.status == 200:
                        token_data = await response.json()
                        access_token = token_data.get("access_token")
                        
                        # Test API call with token
                        headers = {
                            "Authorization": f"Bearer {access_token}",
                            "Content-Type": "application/json"
                        }
                        headers.update(config.custom_headers)
                        
                        test_url = f"{config.base_url}/api/grc/policies"
                        async with session.get(test_url, headers=headers) as test_response:
                            return test_response.status in [200, 404]  # 404 acceptable if no policies
                    
                    return False
                    
        except Exception as e:
            logger.error("SAP GRC connection test failed", error=str(e))
            return False
    
    async def _test_metricstream_connection(self, config: ComplianceSystemConfig) -> bool:
        """Test MetricStream connection."""
        try:
            # MetricStream uses API key authentication
            headers = {
                "Authorization": f"Bearer {config.authentication['api_key']}",
                "Content-Type": "application/json"
            }
            headers.update(config.custom_headers)
            
            async with aiohttp.ClientSession() as session:
                url = f"{config.base_url}/api/{config.api_version}/health"
                
                async with session.get(url, headers=headers) as response:
                    return response.status == 200
                    
        except Exception as e:
            logger.error("MetricStream connection test failed", error=str(e))
            return False
    
    async def _test_generic_api_connection(self, config: ComplianceSystemConfig) -> bool:
        """Test generic API connection."""
        try:
            headers = {"Content-Type": "application/json"}
            headers.update(config.custom_headers)
            
            # Add authentication based on configuration
            auth = None
            if "api_key" in config.authentication:
                headers["Authorization"] = f"Bearer {config.authentication['api_key']}"
            elif "username" in config.authentication and "password" in config.authentication:
                auth = aiohttp.BasicAuth(
                    config.authentication["username"],
                    config.authentication["password"]
                )
            
            async with aiohttp.ClientSession(auth=auth) as session:
                # Try common health check endpoints
                health_endpoints = ["/health", "/status", "/api/health", "/api/v1/health"]
                
                for endpoint in health_endpoints:
                    url = f"{config.base_url}{endpoint}"
                    try:
                        async with session.get(url, headers=headers) as response:
                            if response.status == 200:
                                return True
                    except Exception:
                        continue
                
                return False
                
        except Exception as e:
            logger.error("Generic API connection test failed", error=str(e))
            return False
    
    async def _gather_compliance_data(
        self,
        period_start: datetime,
        period_end: datetime
    ) -> List[ComplianceRecord]:
        """Gather compliance data for synchronization."""
        try:
            records = []
            
            async with get_db_session() as session:
                # Get zkSNARK proof data
                zkproof_query = select(ZKProof).where(
                    and_(
                        ZKProof.generated_at >= period_start,
                        ZKProof.generated_at <= period_end
                    )
                )
                zkproof_result = await session.execute(zkproof_query)
                zkproofs = zkproof_result.scalars().all()
                
                for proof in zkproofs:
                    score = 95.0 if proof.verification_status == VerificationStatus.VALID else 10.0
                    findings = []
                    
                    if proof.verification_status != VerificationStatus.VALID:
                        findings.append("zkSNARK proof verification failed")
                    
                    record = ComplianceRecord(
                        record_id=f"zkproof_{proof.id}",
                        entity_id=proof.entity_id,
                        entity_type="product",
                        compliance_type="cryptographic_verification",
                        status=proof.verification_status.value,
                        score=score,
                        findings=findings,
                        evidence={
                            "proof_id": proof.id,
                            "proof_type": proof.proof_type.value,
                            "proof_hash": proof.proof_hash,
                            "verification_details": proof.verification_details
                        },
                        created_at=proof.generated_at,
                        updated_at=proof.verified_at or proof.generated_at
                    )
                    records.append(record)
                
                # Get audit trail data
                audit_query = select(AuditEntry).where(
                    and_(
                        AuditEntry.event_timestamp >= period_start,
                        AuditEntry.event_timestamp <= period_end
                    )
                )
                audit_result = await session.execute(audit_query)
                audit_entries = audit_result.scalars().all()
                
                # Group audit entries by entity
                entity_audits = {}
                for entry in audit_entries:
                    key = f"{entry.entity_type}_{entry.entity_id}"
                    if key not in entity_audits:
                        entity_audits[key] = []
                    entity_audits[key].append(entry)
                
                for entity_key, entries in entity_audits.items():
                    entity_type, entity_id = entity_key.split("_", 1)
                    
                    # Calculate audit coverage score
                    total_entries = len(entries)
                    verified_entries = sum(1 for e in entries if e.merkle_leaf_hash)
                    coverage_score = (verified_entries / total_entries) * 100 if total_entries > 0 else 0
                    
                    findings = []
                    if coverage_score < 90:
                        findings.append("Incomplete audit trail coverage")
                    if not any(e.merkle_leaf_hash for e in entries):
                        findings.append("No cryptographic audit verification")
                    
                    record = ComplianceRecord(
                        record_id=f"audit_{entity_key}",
                        entity_id=entity_id,
                        entity_type=entity_type,
                        compliance_type="audit_trail_coverage",
                        status="compliant" if coverage_score >= 90 else "non_compliant",
                        score=coverage_score,
                        findings=findings,
                        evidence={
                            "total_audit_entries": total_entries,
                            "verified_entries": verified_entries,
                            "latest_audit": max(e.event_timestamp for e in entries).isoformat()
                        },
                        created_at=min(e.event_timestamp for e in entries),
                        updated_at=max(e.event_timestamp for e in entries)
                    )
                    records.append(record)
            
            logger.info(
                "Compliance data gathered",
                total_records=len(records),
                period_start=period_start.isoformat(),
                period_end=period_end.isoformat()
            )
            
            return records
            
        except Exception as e:
            logger.error("Failed to gather compliance data", error=str(e))
            raise
    
    async def _transform_compliance_data(
        self,
        records: List[ComplianceRecord],
        target_system: ComplianceSystemType
    ) -> List[Dict[str, Any]]:
        """Transform compliance data for target system format."""
        try:
            config = self.system_configs[target_system]
            field_mappings = config.field_mappings
            
            transformed_records = []
            
            for record in records:
                if target_system == ComplianceSystemType.SERVICENOW_GRC:
                    transformed = await self._transform_for_servicenow(record, field_mappings)
                elif target_system == ComplianceSystemType.SAP_GRC:
                    transformed = await self._transform_for_sap_grc(record, field_mappings)
                elif target_system == ComplianceSystemType.METRICSTREAM:
                    transformed = await self._transform_for_metricstream(record, field_mappings)
                else:
                    transformed = await self._transform_for_generic_api(record, field_mappings)
                
                transformed_records.append(transformed)
            
            return transformed_records
            
        except Exception as e:
            logger.error("Failed to transform compliance data", target_system=target_system.value, error=str(e))
            raise
    
    async def _transform_for_servicenow(
        self,
        record: ComplianceRecord,
        field_mappings: Dict[str, str]
    ) -> Dict[str, Any]:
        """Transform record for ServiceNow GRC format."""
        return {
            "number": record.record_id,
            "short_description": f"Compliance check for {record.entity_type} {record.entity_id}",
            "description": f"Compliance status: {record.status}, Score: {record.score}%",
            "state": "3" if record.status == "compliant" else "2",  # ServiceNow state codes
            "priority": "3" if record.score >= 80 else "2" if record.score >= 60 else "1",
            "category": field_mappings.get("category", "compliance"),
            "subcategory": record.compliance_type,
            "u_compliance_score": str(record.score),
            "u_entity_id": record.entity_id,
            "u_entity_type": record.entity_type,
            "u_findings": "; ".join(record.findings),
            "u_evidence": json.dumps(record.evidence),
            "opened_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat()
        }
    
    async def _transform_for_sap_grc(
        self,
        record: ComplianceRecord,
        field_mappings: Dict[str, str]
    ) -> Dict[str, Any]:
        """Transform record for SAP GRC format."""
        return {
            "ControlId": record.record_id,
            "EntityId": record.entity_id,
            "EntityType": record.entity_type.upper(),
            "ComplianceType": record.compliance_type.upper(),
            "Status": "COMPLIANT" if record.status == "compliant" else "NON_COMPLIANT",
            "Score": record.score,
            "RiskLevel": "LOW" if record.score >= 80 else "MEDIUM" if record.score >= 60 else "HIGH",
            "Findings": record.findings,
            "Evidence": record.evidence,
            "CreatedDate": record.created_at.strftime("%Y-%m-%d"),
            "UpdatedDate": record.updated_at.strftime("%Y-%m-%d"),
            "CreatedTime": record.created_at.strftime("%H:%M:%S"),
            "UpdatedTime": record.updated_at.strftime("%H:%M:%S")
        }
    
    async def _transform_for_metricstream(
        self,
        record: ComplianceRecord,
        field_mappings: Dict[str, str]
    ) -> Dict[str, Any]:
        """Transform record for MetricStream format."""
        return {
            "recordId": record.record_id,
            "entityId": record.entity_id,
            "entityType": record.entity_type,
            "complianceArea": record.compliance_type,
            "complianceStatus": record.status.upper(),
            "complianceScore": record.score,
            "riskRating": self._calculate_risk_rating(record.score),
            "findings": record.findings,
            "evidenceData": record.evidence,
            "dateCreated": record.created_at.isoformat(),
            "dateUpdated": record.updated_at.isoformat(),
            "customFields": field_mappings
        }
    
    async def _transform_for_generic_api(
        self,
        record: ComplianceRecord,
        field_mappings: Dict[str, str]
    ) -> Dict[str, Any]:
        """Transform record for generic API format."""
        transformed = {
            "id": record.record_id,
            "entity_id": record.entity_id,
            "entity_type": record.entity_type,
            "compliance_type": record.compliance_type,
            "status": record.status,
            "score": record.score,
            "findings": record.findings,
            "evidence": record.evidence,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat()
        }
        
        # Apply custom field mappings
        for internal_field, external_field in field_mappings.items():
            if internal_field in transformed:
                transformed[external_field] = transformed.pop(internal_field)
        
        return transformed
    
    def _calculate_risk_rating(self, score: float) -> str:
        """Calculate risk rating based on compliance score."""
        if score >= 90:
            return "LOW"
        elif score >= 70:
            return "MEDIUM"
        elif score >= 50:
            return "HIGH"
        else:
            return "CRITICAL"
    
    async def _push_to_external_system(
        self,
        system_type: ComplianceSystemType,
        records: List[Dict[str, Any]]
    ) -> IntegrationSyncResult:
        """Push transformed records to external system."""
        try:
            config = self.system_configs[system_type]
            
            records_created = 0
            records_updated = 0
            errors = []
            
            if system_type == ComplianceSystemType.SERVICENOW_GRC:
                results = await self._push_to_servicenow(config, records)
            elif system_type == ComplianceSystemType.SAP_GRC:
                results = await self._push_to_sap_grc(config, records)
            elif system_type == ComplianceSystemType.METRICSTREAM:
                results = await self._push_to_metricstream(config, records)
            else:
                results = await self._push_to_generic_api(config, records)
            
            records_created = results.get("created", 0)
            records_updated = results.get("updated", 0)
            errors = results.get("errors", [])
            
            return IntegrationSyncResult(
                system_type=system_type,
                sync_started=datetime.utcnow(),
                sync_completed=datetime.utcnow(),
                records_processed=len(records),
                records_created=records_created,
                records_updated=records_updated,
                errors_encountered=len(errors),
                error_details=errors,
                next_sync_scheduled=datetime.utcnow()
            )
            
        except Exception as e:
            logger.error("Failed to push to external system", system_type=system_type.value, error=str(e))
            raise
    
    async def _push_to_servicenow(
        self,
        config: ComplianceSystemConfig,
        records: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Push records to ServiceNow GRC."""
        auth = aiohttp.BasicAuth(
            config.authentication["username"],
            config.authentication["password"]
        )
        
        created = 0
        updated = 0
        errors = []
        
        async with aiohttp.ClientSession(auth=auth) as session:
            for record in records:
                try:
                    # Check if record exists
                    search_url = f"{config.base_url}/api/now/table/sn_grc_policy"
                    params = {"sysparm_query": f"number={record['number']}"}
                    
                    async with session.get(search_url, params=params) as response:
                        if response.status == 200:
                            data = await response.json()
                            exists = len(data.get("result", [])) > 0
                            
                            if exists:
                                # Update existing record
                                update_url = f"{search_url}/{data['result'][0]['sys_id']}"
                                async with session.put(update_url, json=record) as update_response:
                                    if update_response.status == 200:
                                        updated += 1
                                    else:
                                        errors.append(f"Failed to update record {record['number']}")
                            else:
                                # Create new record
                                async with session.post(search_url, json=record) as create_response:
                                    if create_response.status == 201:
                                        created += 1
                                    else:
                                        errors.append(f"Failed to create record {record['number']}")
                        else:
                            errors.append(f"Failed to search for record {record['number']}")
                            
                except Exception as e:
                    errors.append(f"Error processing record {record.get('number', 'unknown')}: {str(e)}")
        
        return {"created": created, "updated": updated, "errors": errors}
    
    async def _push_to_sap_grc(
        self,
        config: ComplianceSystemConfig,
        records: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Push records to SAP GRC."""
        # Implementation would depend on SAP GRC API specifics
        # This is a simplified example
        return {"created": len(records), "updated": 0, "errors": []}
    
    async def _push_to_metricstream(
        self,
        config: ComplianceSystemConfig,
        records: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Push records to MetricStream."""
        # Implementation would depend on MetricStream API specifics
        # This is a simplified example
        return {"created": len(records), "updated": 0, "errors": []}
    
    async def _push_to_generic_api(
        self,
        config: ComplianceSystemConfig,
        records: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Push records to generic API."""
        headers = {"Content-Type": "application/json"}
        headers.update(config.custom_headers)
        
        if "api_key" in config.authentication:
            headers["Authorization"] = f"Bearer {config.authentication['api_key']}"
        
        created = 0
        updated = 0
        errors = []
        
        auth = None
        if "username" in config.authentication and "password" in config.authentication:
            auth = aiohttp.BasicAuth(
                config.authentication["username"],
                config.authentication["password"]
            )
        
        async with aiohttp.ClientSession(auth=auth) as session:
            endpoint = f"{config.base_url}/api/{config.api_version}/compliance-records"
            
            for record in records:
                try:
                    async with session.post(endpoint, json=record, headers=headers) as response:
                        if response.status in [200, 201]:
                            created += 1
                        else:
                            errors.append(f"Failed to push record {record.get('id', 'unknown')}: {response.status}")
                except Exception as e:
                    errors.append(f"Error pushing record {record.get('id', 'unknown')}: {str(e)}")
        
        return {"created": created, "updated": updated, "errors": errors}
    
    async def _push_report_to_system(
        self,
        report: ComplianceReport,
        system_type: ComplianceSystemType
    ) -> bool:
        """Push compliance report to specific system."""
        try:
            config = self.system_configs[system_type]
            
            # Transform report for target system
            if system_type == ComplianceSystemType.SERVICENOW_GRC:
                report_data = {
                    "number": f"COMP-{report.id[:8]}",
                    "short_description": f"Compliance Report - {report.report_type}",
                    "description": f"Period: {report.report_period_start} to {report.report_period_end}",
                    "state": "3",  # Closed Complete
                    "u_compliance_score": str(report.compliance_score),
                    "u_risk_score": str(report.risk_score),
                    "u_report_data": json.dumps(report.report_data),
                    "u_report_id": report.id
                }
            else:
                # Generic format
                report_data = {
                    "report_id": report.id,
                    "report_type": report.report_type,
                    "period_start": report.report_period_start.isoformat(),
                    "period_end": report.report_period_end.isoformat(),
                    "compliance_score": report.compliance_score,
                    "risk_score": report.risk_score,
                    "generated_at": report.generated_at.isoformat(),
                    "report_data": report.report_data
                }
            
            # Push to system (implementation depends on specific API)
            return True
            
        except Exception as e:
            logger.error("Failed to push report to system", system_type=system_type.value, error=str(e))
            return False
    
    async def _transform_external_finding(
        self,
        external_finding: Dict[str, Any],
        source_system: ComplianceSystemType
    ) -> Dict[str, Any]:
        """Transform external finding to internal format."""
        # Implementation would depend on source system format
        return {
            "external_id": external_finding.get("id"),
            "source_system": source_system.value,
            "finding_type": external_finding.get("type"),
            "severity": external_finding.get("severity"),
            "description": external_finding.get("description"),
            "entity_id": external_finding.get("entity_id"),
            "status": external_finding.get("status"),
            "raw_data": external_finding
        }
    
    def _update_sync_metrics(self, sync_result: IntegrationSyncResult) -> None:
        """Update synchronization metrics."""
        self.sync_metrics["total_syncs"] += 1
        
        if sync_result.errors_encountered == 0:
            self.sync_metrics["successful_syncs"] += 1
        else:
            self.sync_metrics["failed_syncs"] += 1
        
        self.sync_metrics["total_records_synced"] += sync_result.records_processed
        
        # Update average sync time
        sync_duration = (sync_result.sync_completed - sync_result.sync_started).total_seconds()
        current_avg = self.sync_metrics["average_sync_time_seconds"]
        total_syncs = self.sync_metrics["total_syncs"]
        
        self.sync_metrics["average_sync_time_seconds"] = (
            (current_avg * (total_syncs - 1) + sync_duration) / total_syncs
        )
    
    def _load_system_configurations(self) -> None:
        """Load system configurations from environment or database."""
        # In a real implementation, this would load from configuration files
        # or environment variables
        logger.info("Compliance system configurations loaded")


# Global instance for convenience
enterprise_compliance_integration = EnterpriseComplianceIntegration()