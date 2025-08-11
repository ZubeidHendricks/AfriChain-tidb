"""
Cryptographic utilities for zkSNARK proofs and audit trail systems.

Provides secure hashing, digital signatures, key management, and
cryptographic verification functions for enterprise security requirements.
"""

import hashlib
import hmac
import secrets
import base64
import json
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple, Union
from dataclasses import dataclass
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.exceptions import InvalidSignature
import structlog

logger = structlog.get_logger(__name__)


@dataclass
class KeyPair:
    """RSA key pair for signing and verification."""
    private_key: rsa.RSAPrivateKey
    public_key: rsa.RSAPublicKey
    key_id: str
    created_at: datetime


@dataclass
class DigitalSignature:
    """Digital signature with metadata."""
    signature: bytes
    algorithm: str
    key_id: str
    timestamp: datetime
    signed_hash: str


@dataclass
class EncryptionResult:
    """Encryption result with metadata."""
    ciphertext: bytes
    iv: bytes
    algorithm: str
    key_id: str
    timestamp: datetime


class CryptoUtils:
    """Cryptographic utilities for secure operations."""
    
    def __init__(self):
        """Initialize crypto utilities."""
        self.backend = default_backend()
        self.key_store = {}  # In production, use HSM or secure key storage
        self.signature_algorithm = padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH
        )
        self.hash_algorithm = hashes.SHA256()
    
    def generate_secure_hash(
        self, 
        data: Union[str, bytes, Dict[str, Any]], 
        algorithm: str = "sha256"
    ) -> str:
        """
        Generate secure hash of data.
        
        Args:
            data: Data to hash
            algorithm: Hash algorithm to use
            
        Returns:
            Hex-encoded hash
        """
        try:
            # Normalize data to bytes
            if isinstance(data, str):
                data_bytes = data.encode('utf-8')
            elif isinstance(data, dict):
                data_bytes = json.dumps(data, sort_keys=True).encode('utf-8')
            else:
                data_bytes = data
            
            # Generate hash
            if algorithm == "sha256":
                hash_obj = hashlib.sha256()
            elif algorithm == "sha512":
                hash_obj = hashlib.sha512()
            elif algorithm == "sha3_256":
                hash_obj = hashlib.sha3_256()
            else:
                raise ValueError(f"Unsupported hash algorithm: {algorithm}")
            
            hash_obj.update(data_bytes)
            return hash_obj.hexdigest()
            
        except Exception as e:
            logger.error("Failed to generate hash", algorithm=algorithm, error=str(e))
            raise
    
    def generate_merkle_hash(self, left_hash: str, right_hash: str) -> str:
        """Generate Merkle tree parent hash from two child hashes."""
        combined = left_hash + right_hash
        return self.generate_secure_hash(combined)
    
    def generate_hmac(
        self, 
        data: Union[str, bytes], 
        key: Union[str, bytes],
        algorithm: str = "sha256"
    ) -> str:
        """
        Generate HMAC for data with key.
        
        Args:
            data: Data to authenticate
            key: Secret key
            algorithm: HMAC algorithm
            
        Returns:
            Hex-encoded HMAC
        """
        try:
            # Normalize inputs
            if isinstance(data, str):
                data = data.encode('utf-8')
            if isinstance(key, str):
                key = key.encode('utf-8')
            
            # Generate HMAC
            if algorithm == "sha256":
                h = hmac.new(key, data, hashlib.sha256)
            elif algorithm == "sha512":
                h = hmac.new(key, data, hashlib.sha512)
            else:
                raise ValueError(f"Unsupported HMAC algorithm: {algorithm}")
            
            return h.hexdigest()
            
        except Exception as e:
            logger.error("Failed to generate HMAC", algorithm=algorithm, error=str(e))
            raise
    
    def verify_hmac(
        self, 
        data: Union[str, bytes], 
        key: Union[str, bytes],
        expected_hmac: str,
        algorithm: str = "sha256"
    ) -> bool:
        """Verify HMAC authenticity."""
        try:
            calculated_hmac = self.generate_hmac(data, key, algorithm)
            return hmac.compare_digest(calculated_hmac, expected_hmac)
        except Exception as e:
            logger.error("Failed to verify HMAC", error=str(e))
            return False
    
    def generate_key_pair(self, key_size: int = 2048) -> KeyPair:
        """
        Generate RSA key pair for signing and verification.
        
        Args:
            key_size: RSA key size in bits
            
        Returns:
            Generated key pair
        """
        try:
            # Generate private key
            private_key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=key_size,
                backend=self.backend
            )
            
            # Get public key
            public_key = private_key.public_key()
            
            # Generate key ID
            key_id = self.generate_secure_hash(
                public_key.public_numbers().n.to_bytes(key_size // 8, 'big')
            )[:16]
            
            key_pair = KeyPair(
                private_key=private_key,
                public_key=public_key,
                key_id=key_id,
                created_at=datetime.utcnow()
            )
            
            # Store in key store
            self.key_store[key_id] = key_pair
            
            logger.info("Generated RSA key pair", key_id=key_id, key_size=key_size)
            
            return key_pair
            
        except Exception as e:
            logger.error("Failed to generate key pair", error=str(e))
            raise
    
    def sign_data(
        self, 
        data: Union[str, bytes, Dict[str, Any]], 
        key_id: str
    ) -> DigitalSignature:
        """
        Sign data with private key.
        
        Args:
            data: Data to sign
            key_id: ID of key to use for signing
            
        Returns:
            Digital signature
        """
        try:
            # Get key pair
            key_pair = self.key_store.get(key_id)
            if not key_pair:
                raise ValueError(f"Key {key_id} not found")
            
            # Generate hash of data
            data_hash = self.generate_secure_hash(data)
            
            # Normalize data for signing
            if isinstance(data, str):
                data_bytes = data.encode('utf-8')
            elif isinstance(data, dict):
                data_bytes = json.dumps(data, sort_keys=True).encode('utf-8')
            else:
                data_bytes = data
            
            # Sign data
            signature = key_pair.private_key.sign(
                data_bytes,
                self.signature_algorithm,
                self.hash_algorithm
            )
            
            digital_signature = DigitalSignature(
                signature=signature,
                algorithm="RSA-PSS-SHA256",
                key_id=key_id,
                timestamp=datetime.utcnow(),
                signed_hash=data_hash
            )
            
            logger.info("Data signed", key_id=key_id, data_hash=data_hash[:16])
            
            return digital_signature
            
        except Exception as e:
            logger.error("Failed to sign data", key_id=key_id, error=str(e))
            raise
    
    def verify_signature(
        self, 
        data: Union[str, bytes, Dict[str, Any]], 
        signature: DigitalSignature
    ) -> bool:
        """
        Verify digital signature.
        
        Args:
            data: Original data
            signature: Digital signature to verify
            
        Returns:
            True if signature is valid, False otherwise
        """
        try:
            # Get key pair
            key_pair = self.key_store.get(signature.key_id)
            if not key_pair:
                logger.error("Key not found for signature verification", key_id=signature.key_id)
                return False
            
            # Normalize data
            if isinstance(data, str):
                data_bytes = data.encode('utf-8')
            elif isinstance(data, dict):
                data_bytes = json.dumps(data, sort_keys=True).encode('utf-8')
            else:
                data_bytes = data
            
            # Verify signature
            try:
                key_pair.public_key.verify(
                    signature.signature,
                    data_bytes,
                    self.signature_algorithm,
                    self.hash_algorithm
                )
                
                logger.info("Signature verified successfully", key_id=signature.key_id)
                return True
                
            except InvalidSignature:
                logger.warning("Invalid signature", key_id=signature.key_id)
                return False
            
        except Exception as e:
            logger.error("Failed to verify signature", error=str(e))
            return False
    
    def encrypt_data(
        self, 
        data: Union[str, bytes], 
        key: Optional[bytes] = None
    ) -> EncryptionResult:
        """
        Encrypt data using AES-256-GCM.
        
        Args:
            data: Data to encrypt
            key: Encryption key (generated if not provided)
            
        Returns:
            Encryption result
        """
        try:
            # Generate key if not provided
            if key is None:
                key = secrets.token_bytes(32)  # 256-bit key
            
            # Generate random IV
            iv = secrets.token_bytes(12)  # 96-bit IV for GCM
            
            # Normalize data
            if isinstance(data, str):
                data_bytes = data.encode('utf-8')
            else:
                data_bytes = data
            
            # Create cipher
            cipher = Cipher(
                algorithms.AES(key),
                modes.GCM(iv),
                backend=self.backend
            )
            
            # Encrypt data
            encryptor = cipher.encryptor()
            ciphertext = encryptor.update(data_bytes) + encryptor.finalize()
            
            # Combine ciphertext with authentication tag
            ciphertext_with_tag = ciphertext + encryptor.tag
            
            # Generate key ID
            key_id = self.generate_secure_hash(key)[:16]
            
            result = EncryptionResult(
                ciphertext=ciphertext_with_tag,
                iv=iv,
                algorithm="AES-256-GCM",
                key_id=key_id,
                timestamp=datetime.utcnow()
            )
            
            logger.info("Data encrypted", key_id=key_id, data_size=len(data_bytes))
            
            return result
            
        except Exception as e:
            logger.error("Failed to encrypt data", error=str(e))
            raise
    
    def decrypt_data(
        self, 
        encryption_result: EncryptionResult, 
        key: bytes
    ) -> bytes:
        """
        Decrypt data using AES-256-GCM.
        
        Args:
            encryption_result: Encryption result to decrypt
            key: Decryption key
            
        Returns:
            Decrypted data
        """
        try:
            # Split ciphertext and authentication tag
            ciphertext = encryption_result.ciphertext[:-16]
            tag = encryption_result.ciphertext[-16:]
            
            # Create cipher
            cipher = Cipher(
                algorithms.AES(key),
                modes.GCM(encryption_result.iv, tag),
                backend=self.backend
            )
            
            # Decrypt data
            decryptor = cipher.decryptor()
            plaintext = decryptor.update(ciphertext) + decryptor.finalize()
            
            logger.info("Data decrypted", key_id=encryption_result.key_id)
            
            return plaintext
            
        except Exception as e:
            logger.error("Failed to decrypt data", error=str(e))
            raise
    
    def generate_random_bytes(self, length: int) -> bytes:
        """Generate cryptographically secure random bytes."""
        return secrets.token_bytes(length)
    
    def generate_random_string(self, length: int) -> str:
        """Generate cryptographically secure random string."""
        return secrets.token_urlsafe(length)
    
    def derive_key(
        self, 
        password: str, 
        salt: bytes, 
        key_length: int = 32,
        iterations: int = 100000
    ) -> bytes:
        """
        Derive key from password using PBKDF2.
        
        Args:
            password: Password to derive from
            salt: Salt for key derivation
            key_length: Length of derived key in bytes
            iterations: Number of PBKDF2 iterations
            
        Returns:
            Derived key
        """
        try:
            from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
            
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=key_length,
                salt=salt,
                iterations=iterations,
                backend=self.backend
            )
            
            key = kdf.derive(password.encode('utf-8'))
            
            logger.info("Key derived from password", key_length=key_length, iterations=iterations)
            
            return key
            
        except Exception as e:
            logger.error("Failed to derive key", error=str(e))
            raise
    
    def create_integrity_proof(
        self, 
        data: Union[str, bytes, Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Create integrity proof for data.
        
        Args:
            data: Data to create proof for
            
        Returns:
            Integrity proof data
        """
        try:
            # Generate multiple hashes for redundancy
            sha256_hash = self.generate_secure_hash(data, "sha256")
            sha512_hash = self.generate_secure_hash(data, "sha512")
            sha3_hash = self.generate_secure_hash(data, "sha3_256")
            
            # Create timestamp
            timestamp = datetime.utcnow()
            
            # Create proof structure
            proof = {
                "timestamp": timestamp.isoformat(),
                "hashes": {
                    "sha256": sha256_hash,
                    "sha512": sha512_hash,
                    "sha3_256": sha3_hash
                },
                "proof_version": "1.0",
                "algorithm_count": 3
            }
            
            # Add proof hash
            proof["proof_hash"] = self.generate_secure_hash(proof["hashes"])
            
            logger.info("Integrity proof created", proof_hash=proof["proof_hash"][:16])
            
            return proof
            
        except Exception as e:
            logger.error("Failed to create integrity proof", error=str(e))
            raise
    
    def verify_integrity_proof(
        self, 
        data: Union[str, bytes, Dict[str, Any]], 
        proof: Dict[str, Any]
    ) -> bool:
        """
        Verify integrity proof for data.
        
        Args:
            data: Data to verify
            proof: Integrity proof
            
        Returns:
            True if proof is valid, False otherwise
        """
        try:
            # Recreate hashes
            sha256_hash = self.generate_secure_hash(data, "sha256")
            sha512_hash = self.generate_secure_hash(data, "sha512")
            sha3_hash = self.generate_secure_hash(data, "sha3_256")
            
            # Verify each hash
            expected_hashes = proof.get("hashes", {})
            
            if expected_hashes.get("sha256") != sha256_hash:
                logger.warning("SHA256 hash mismatch in integrity proof")
                return False
            
            if expected_hashes.get("sha512") != sha512_hash:
                logger.warning("SHA512 hash mismatch in integrity proof")
                return False
            
            if expected_hashes.get("sha3_256") != sha3_hash:
                logger.warning("SHA3-256 hash mismatch in integrity proof")
                return False
            
            # Verify proof hash
            expected_proof_hash = self.generate_secure_hash(expected_hashes)
            if proof.get("proof_hash") != expected_proof_hash:
                logger.warning("Proof hash mismatch")
                return False
            
            logger.info("Integrity proof verified successfully")
            return True
            
        except Exception as e:
            logger.error("Failed to verify integrity proof", error=str(e))
            return False
    
    def export_public_key(self, key_id: str) -> str:
        """
        Export public key in PEM format.
        
        Args:
            key_id: ID of key to export
            
        Returns:
            PEM-encoded public key
        """
        try:
            key_pair = self.key_store.get(key_id)
            if not key_pair:
                raise ValueError(f"Key {key_id} not found")
            
            pem = key_pair.public_key.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo
            )
            
            return pem.decode('utf-8')
            
        except Exception as e:
            logger.error("Failed to export public key", key_id=key_id, error=str(e))
            raise
    
    def import_public_key(self, pem_data: str, key_id: Optional[str] = None) -> str:
        """
        Import public key from PEM format.
        
        Args:
            pem_data: PEM-encoded public key
            key_id: Optional key ID (generated if not provided)
            
        Returns:
            Key ID of imported key
        """
        try:
            public_key = serialization.load_pem_public_key(
                pem_data.encode('utf-8'),
                backend=self.backend
            )
            
            # Generate key ID if not provided
            if key_id is None:
                key_id = self.generate_secure_hash(pem_data)[:16]
            
            # Create key pair with public key only
            key_pair = KeyPair(
                private_key=None,
                public_key=public_key,
                key_id=key_id,
                created_at=datetime.utcnow()
            )
            
            self.key_store[key_id] = key_pair
            
            logger.info("Public key imported", key_id=key_id)
            
            return key_id
            
        except Exception as e:
            logger.error("Failed to import public key", error=str(e))
            raise
    
    def get_key_info(self, key_id: str) -> Dict[str, Any]:
        """Get information about a key."""
        key_pair = self.key_store.get(key_id)
        if not key_pair:
            return {}
        
        return {
            "key_id": key_id,
            "has_private_key": key_pair.private_key is not None,
            "created_at": key_pair.created_at.isoformat(),
            "key_size": key_pair.public_key.key_size if key_pair.public_key else None
        }
    
    def list_keys(self) -> List[Dict[str, Any]]:
        """List all keys in the key store."""
        return [self.get_key_info(key_id) for key_id in self.key_store.keys()]
    
    def create_checksum(
        self, 
        data: Union[str, bytes], 
        algorithm: str = "crc32"
    ) -> str:
        """Create checksum for data integrity verification."""
        try:
            if isinstance(data, str):
                data = data.encode('utf-8')
            
            if algorithm == "crc32":
                import zlib
                checksum = zlib.crc32(data)
                return f"{checksum:08x}"
            elif algorithm == "adler32":
                import zlib
                checksum = zlib.adler32(data)
                return f"{checksum:08x}"
            else:
                # Fall back to SHA256
                return self.generate_secure_hash(data, "sha256")[:16]
                
        except Exception as e:
            logger.error("Failed to create checksum", algorithm=algorithm, error=str(e))
            raise
    
    def verify_checksum(
        self, 
        data: Union[str, bytes], 
        expected_checksum: str,
        algorithm: str = "crc32"
    ) -> bool:
        """Verify data checksum."""
        try:
            calculated_checksum = self.create_checksum(data, algorithm)
            return calculated_checksum == expected_checksum
        except Exception as e:
            logger.error("Failed to verify checksum", error=str(e))
            return False


class SecureRandomGenerator:
    """Cryptographically secure random number generator."""
    
    def __init__(self):
        """Initialize secure random generator."""
        self.entropy_pool = bytearray()
        self.reseed_counter = 0
        self.reseed_interval = 1000
    
    def generate_bytes(self, length: int) -> bytes:
        """Generate secure random bytes."""
        self._check_reseed()
        return secrets.token_bytes(length)
    
    def generate_int(self, min_value: int, max_value: int) -> int:
        """Generate secure random integer in range."""
        self._check_reseed()
        return secrets.randbelow(max_value - min_value + 1) + min_value
    
    def generate_float(self) -> float:
        """Generate secure random float between 0 and 1."""
        self._check_reseed()
        return secrets.randbits(32) / (2**32)
    
    def generate_uuid(self) -> str:
        """Generate cryptographically secure UUID."""
        import uuid
        return str(uuid.UUID(bytes=self.generate_bytes(16), version=4))
    
    def shuffle_list(self, items: List[Any]) -> List[Any]:
        """Securely shuffle a list."""
        shuffled = items.copy()
        for i in range(len(shuffled) - 1, 0, -1):
            j = self.generate_int(0, i)
            shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
        return shuffled
    
    def _check_reseed(self) -> None:
        """Check if reseeding is needed."""
        self.reseed_counter += 1
        if self.reseed_counter >= self.reseed_interval:
            self._reseed()
            self.reseed_counter = 0
    
    def _reseed(self) -> None:
        """Reseed the entropy pool."""
        # Add additional entropy from various sources
        entropy_sources = [
            secrets.token_bytes(32),
            str(datetime.utcnow().timestamp()).encode(),
            str(id(self)).encode()
        ]
        
        for source in entropy_sources:
            self.entropy_pool.extend(source)
        
        # Keep pool size reasonable
        if len(self.entropy_pool) > 1024:
            self.entropy_pool = self.entropy_pool[-512:]


# Global instances for convenience
crypto_utils = CryptoUtils()
secure_random = SecureRandomGenerator()