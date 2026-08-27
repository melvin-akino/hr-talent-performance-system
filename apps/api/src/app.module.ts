import { Global, Module } from '@nestjs/common';
import { DbService } from './db/db.service';
import { AuthGuard } from './auth/auth.guard';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { EmployeeImportService } from './import/employee-import.service';
import { HealthController } from './health/health.controller';
import { GoalsController } from './goals/goals.controller';
import { GoalsService } from './goals/goals.service';
import { KpiService } from './goals/kpi.service';
import { DashboardService } from './goals/dashboard.service';
import { PipController } from './pip/pip.controller';
import { PipService } from './pip/pip.service';
import { MonitoringService } from './pip/monitoring.service';
import { ReviewsController } from './reviews/reviews.controller';
import { ReviewsService } from './reviews/reviews.service';
import { FormsService } from './reviews/forms.service';
import { CompetenciesController } from './competencies/competencies.controller';
import { CompetenciesService } from './competencies/competencies.service';
import { ReferenceDataController } from './admin/reference-data.controller';
import { ReferenceDataService } from './admin/reference-data.service';
import { Ph201ImportService } from './import/ph201-import.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationWorkerService } from './notifications/notification-worker.service';
import { FeedbackService } from './feedback/feedback.service';
import { DevelopmentController } from './development/development.controller';
import { DevelopmentService } from './development/development.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { HelpController } from './help/help.controller';
import { HelpService } from './help/help.service';
import { AnalyticsService } from './analytics/analytics.service';
import { MetricsController } from './metrics/metrics.controller';
import { MetricsService } from './metrics/metrics.service';
import { EvaluationsController } from './metrics/evaluations.controller';
import { EvaluationsService } from './metrics/evaluations.service';

@Global()
@Module({
  controllers: [
    EmployeesController, HealthController, GoalsController, PipController,
    ReviewsController, CompetenciesController, ReferenceDataController,
    NotificationsController, DevelopmentController, AnalyticsController,
    HelpController, MetricsController, EvaluationsController,
  ],
  providers: [
    DbService, AuthGuard, EmployeesService, EmployeeImportService,
    GoalsService, KpiService, DashboardService,
    PipService, MonitoringService,
    ReviewsService, FormsService,
    CompetenciesService, ReferenceDataService, Ph201ImportService,
    NotificationsService, NotificationWorkerService, FeedbackService,
    DevelopmentService, AnalyticsService, HelpService, MetricsService,
    EvaluationsService,
  ],
  exports: [DbService],
})
export class AppModule {}
