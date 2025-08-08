/**
 * Agent Showcase Component
 * 
 * Interactive demonstration of multi-agent AI system
 */

import React, { useState, useEffect } from 'react';
import { Box, Typography, Container, Stack, Chip, LinearProgress } from '@mui/material';
import { styled } from '@mui/material/styles';
import { GlassmorphicCard } from './GlassmorphicCard';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import RuleIcon from '@mui/icons-material/Rule';
import NotificationsIcon from '@mui/icons-material/Notifications';
import GavelIcon from '@mui/icons-material/Gavel';
import { apiService, AgentStatus } from '../services/api';

const AgentContainer = styled(Box)(({ theme }) => ({
  background: 'linear-gradient(180deg, #000000 0%, #1a1a1a 100%)',
  padding: '120px 0',
  position: 'relative',
}));

const AgentCard = styled(GlassmorphicCard)<{ active?: boolean }>(({ theme, active }) => ({
  padding: '24px',
  cursor: 'pointer',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  border: active ? '2px solid #FFD700' : '1px solid rgba(255, 215, 0, 0.2)',
  background: active ? 'rgba(255, 215, 0, 0.15)' : 'rgba(255, 215, 0, 0.08)',
  '&:hover': {
    background: 'rgba(255, 215, 0, 0.12)',
    transform: 'translateY(-8px)',
  },
}));

const WorkflowLine = styled(Box)<{ active?: boolean }>(({ active }) => ({
  height: '2px',
  background: active 
    ? 'linear-gradient(90deg, #FFD700 0%, #FFA500 100%)'
    : 'rgba(255, 215, 0, 0.3)',
  transition: 'all 0.5s ease',
  position: 'relative',
  '&::after': active ? {
    content: '""',
    position: 'absolute',
    top: '-4px',
    right: '-8px',
    width: 0,
    height: 0,
    borderLeft: '8px solid #FFD700',
    borderTop: '5px solid transparent',
    borderBottom: '5px solid transparent',
  } : {},
}));

interface Agent {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: 'idle' | 'processing' | 'complete';
  progress: number;
}

const agents: Agent[] = [
  {
    id: 'orchestrator',
    name: 'Orchestrator Agent',
    description: 'Coordinates all detection workflows and manages agent communication',
    icon: <SmartToyIcon />,
    status: 'idle',
    progress: 0,
  },
  {
    id: 'analyzer',
    name: 'Authenticity Analyzer',
    description: 'Advanced AI-powered product analysis using LLM and computer vision',
    icon: <AnalyticsIcon />,
    status: 'idle',
    progress: 0,
  },
  {
    id: 'rules',
    name: 'Rule Engine',
    description: 'Dynamic detection rules and pattern matching for rapid identification',
    icon: <RuleIcon />,
    status: 'idle',
    progress: 0,
  },
  {
    id: 'notifier',
    name: 'Notification Agent',
    description: 'Multi-channel alerting system for stakeholders and authorities',
    icon: <NotificationsIcon />,
    status: 'idle',
    progress: 0,
  },
  {
    id: 'enforcer',
    name: 'Enforcement Agent',
    description: 'Automated takedown requests and appeals workflow management',
    icon: <GavelIcon />,
    status: 'idle',
    progress: 0,
  },
];

export const AgentShowcase: React.FC = () => {
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [workflowStep, setWorkflowStep] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [realAgents, setRealAgents] = useState<AgentStatus[]>([]);

  useEffect(() => {
    // Fetch real agent data
    const fetchAgents = async () => {
      try {
        const agentData = await apiService.getAgents();
        setRealAgents(agentData);
      } catch (error) {
        console.error('Failed to fetch agent data:', error);
      }
    };

    fetchAgents();

    // Set up periodic updates
    const agentInterval = setInterval(fetchAgents, 10000);

    if (isRunning) {
      const workflowInterval = setInterval(() => {
        setWorkflowStep((prev) => {
          if (prev >= agents.length - 1) {
            setIsRunning(false);
            return 0;
          }
          return prev + 1;
        });
      }, 2000);

      return () => {
        clearInterval(workflowInterval);
        clearInterval(agentInterval);
      };
    }

    return () => clearInterval(agentInterval);
  }, [isRunning]);

  const startDemo = () => {
    setIsRunning(true);
    setWorkflowStep(0);
  };

  const getAgentStatus = (index: number) => {
    if (!isRunning) return 'idle';
    if (index < workflowStep) return 'complete';
    if (index === workflowStep) return 'processing';
    return 'idle';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'processing': return '#FFA500';
      case 'complete': return '#4CAF50';
      default: return '#FFD700';
    }
  };

  return (
    <AgentContainer>
      <Container maxWidth="lg">
        <Stack spacing={8}>
          {/* Header */}
          <Stack spacing={3} alignItems="center" textAlign="center">
            <Typography
              variant="h2"
              sx={{
                background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontWeight: 700,
              }}
            >
              Multi-Agent AI System
            </Typography>
            <Typography
              variant="h6"
              sx={{
                color: 'rgba(255, 255, 255, 0.8)',
                maxWidth: '600px',
                lineHeight: 1.6,
              }}
            >
              Watch our intelligent agents work together to detect and verify product authenticity in real-time
            </Typography>
          </Stack>

          {/* Demo Controls */}
          <Stack direction="row" justifyContent="center" spacing={2}>
            <Chip
              label={isRunning ? "Demo Running..." : "Start Demo"}
              onClick={startDemo}
              disabled={isRunning}
              sx={{
                backgroundColor: '#FFD700',
                color: '#000000',
                fontWeight: 600,
                fontSize: '1rem',
                padding: '8px 16px',
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: '#FFA500',
                },
              }}
            />
          </Stack>

          {/* Agent Workflow */}
          <Stack spacing={4}>
            {agents.map((agent, index) => {
              const status = getAgentStatus(index);
              const isActive = status === 'processing';
              
              return (
                <Box key={agent.id}>
                  <AgentCard
                    active={isActive}
                    onClick={() => setActiveAgent(activeAgent === agent.id ? null : agent.id)}
                  >
                    <Stack direction="row" spacing={3} alignItems="center">
                      <Box
                        sx={{
                          color: getStatusColor(status),
                          fontSize: 40,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {agent.icon}
                      </Box>
                      
                      <Stack spacing={1} flex={1}>
                        <Stack direction="row" alignItems="center" spacing={2}>
                          <Typography
                            variant="h6"
                            sx={{ color: '#FFD700', fontWeight: 600 }}
                          >
                            {agent.name}
                          </Typography>
                          <Chip
                            label={status.toUpperCase()}
                            size="small"
                            sx={{
                              backgroundColor: getStatusColor(status),
                              color: '#000000',
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}
                          />
                        </Stack>
                        
                        <Typography
                          variant="body2"
                          sx={{ color: 'rgba(255, 255, 255, 0.8)' }}
                        >
                          {agent.description}
                        </Typography>
                        
                        {status === 'processing' && (
                          <LinearProgress
                            sx={{
                              mt: 1,
                              backgroundColor: 'rgba(255, 215, 0, 0.2)',
                              '& .MuiLinearProgress-bar': {
                                backgroundColor: '#FFD700',
                              },
                            }}
                          />
                        )}
                      </Stack>
                    </Stack>
                  </AgentCard>
                  
                  {/* Workflow connector */}
                  {index < agents.length - 1 && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                      <WorkflowLine
                        active={workflowStep > index}
                        sx={{ width: '60px' }}
                      />
                    </Box>
                  )}
                </Box>
              );
            })}
          </Stack>

          {/* Results Summary */}
          {!isRunning && workflowStep === 0 && (
            <GlassmorphicCard sx={{ p: 4, textAlign: 'center' }}>
              <Stack spacing={2}>
                <Typography variant="h5" sx={{ color: '#FFD700', fontWeight: 600 }}>
                  Verification Complete
                </Typography>
                <Typography variant="body1" sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
                  Product authenticity verified with 98.7% confidence
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                  Immutable proof stored on Hedera blockchain
                </Typography>
              </Stack>
            </GlassmorphicCard>
          )}
        </Stack>
      </Container>
    </AgentContainer>
  );
};