package com.oneflight.integration;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
@EnableScheduling
@EnableConfigurationProperties(SourceProperties.class)
public class IntegrationConfiguration {
    /** Source grant refresh must continue even while another provider is slow or unavailable. */
    @Bean
    ThreadPoolTaskScheduler sourceTaskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(3);
        scheduler.setThreadNamePrefix("oneflight-source-");
        scheduler.setRemoveOnCancelPolicy(true);
        scheduler.setAwaitTerminationSeconds(10);
        return scheduler;
    }
}
