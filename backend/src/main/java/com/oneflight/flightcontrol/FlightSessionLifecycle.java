package com.oneflight.flightcontrol;

import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import org.springframework.boot.web.servlet.ServletListenerRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FlightSessionLifecycle {
    @Bean
    ServletListenerRegistrationBean<HttpSessionListener> flightTicketSessionListener(FlightLaunchTickets tickets, FlightEntryGrants grants) {
        return new ServletListenerRegistrationBean<>(new HttpSessionListener() {
            @Override public void sessionDestroyed(HttpSessionEvent event) {
                tickets.revoke(event.getSession());
                grants.revoke(event.getSession());
            }
        });
    }
}
