import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EssService } from './ess.service';

@Controller('ess')
@UseGuards(AuthGuard)
export class EssController {
  constructor(private readonly ess: EssService) {}

  @Get('announcements')
  listAnnouncements(@Req() req: AuthenticatedRequest) {
    return this.ess.listAnnouncements(req.auth);
  }

  @Post('announcements')
  createAnnouncement(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      title: string;
      category?: string;
      body: string;
      isPinned?: boolean;
      expiresAt?: string;
    },
  ) {
    return this.ess.createAnnouncement(req.auth, body);
  }

  @Delete('announcements/:id')
  deleteAnnouncement(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ess.deleteAnnouncement(req.auth, id);
  }

  @Get('profile')
  getMyProfile(@Req() req: AuthenticatedRequest) {
    return this.ess.getMyProfile(req.auth);
  }

  @Get('coe')
  generateCoe(
    @Req() req: AuthenticatedRequest,
    @Query('includeCompensation') includeCompensation?: string,
  ) {
    return this.ess.generateCoe(req.auth, includeCompensation === 'true');
  }

  @Get('profile-requests')
  listProfileRequests(@Req() req: AuthenticatedRequest) {
    return this.ess.listProfileRequests(req.auth);
  }

  @Post('profile-requests')
  submitProfileRequest(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      requestType: string;
      requestedChanges: Record<string, string>;
      reason: string;
    },
  ) {
    return this.ess.submitProfileRequest(req.auth, body);
  }

  @Post('profile-requests/:id/approve')
  approveProfileRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    return this.ess.reviewProfileRequest(req.auth, id, 'approved', body?.note);
  }

  @Post('profile-requests/:id/reject')
  rejectProfileRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    return this.ess.reviewProfileRequest(req.auth, id, 'rejected', body?.note);
  }
}

@Controller('offboarding')
@UseGuards(AuthGuard)
export class OffboardingController {
  constructor(private readonly ess: EssService) {}

  @Get()
  listCases(@Req() req: AuthenticatedRequest) {
    return this.ess.listOffboardingCases(req.auth);
  }

  @Post()
  createCase(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      employeeId: string;
      separationDate: string;
      separationReason?: string;
      remarks?: string;
    },
  ) {
    return this.ess.createOffboardingCase(req.auth, body);
  }

  @Patch('clearance/:itemId')
  updateClearanceItem(
    @Req() req: AuthenticatedRequest,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: { status: 'pending' | 'cleared' | 'waived'; notes?: string },
  ) {
    return this.ess.updateClearanceItem(req.auth, itemId, body);
  }

  @Post(':id/compute-final-pay')
  computeFinalPay(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      unpaidBasicPay?: number;
      separationPay?: number;
      otherAdditions?: number;
      otherDeductions?: number;
    },
  ) {
    return this.ess.computeFinalPay(req.auth, id, body);
  }

  @Post(':id/release')
  releaseFinalPay(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ess.releaseFinalPay(req.auth, id);
  }
}
