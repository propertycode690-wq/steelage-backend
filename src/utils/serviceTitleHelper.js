/**
 * Resolves dynamic title, icon, assessment name, and category name based on selected service type.
 * Supports Commercial Construction, Steel Buildings, Civil Works & Project Consultations.
 */
function getServiceTitleInfo(serviceType) {
  const service = String(serviceType || '').toLowerCase();

  // 🏗️ Steel & Commercial Construction Services
  if (service.includes('steel') || service.includes('peb') || service.includes('warehouse') || service.includes('commercial') || service.includes('civil') || service.includes('construction')) {
    return {
      icon: '🏗️',
      title: 'Commercial Construction Consultation',
      assessmentName: 'Site Feasibility & Project Assessment',
      categoryName: 'Commercial & Structural Steel Construction'
    };
  }

  // 🏠 Property / Site Development Service
  if (service.includes('property') || service.includes('investment') || service.includes('land')) {
    return {
      icon: '🏢',
      title: 'Site Development & Construction Consultation',
      assessmentName: 'Site Feasibility & Estimation Assessment',
      categoryName: 'Site Development & Construction Services'
    };
  }

  // 🏗️ Default: Steelage Construction Project Consultation
  return {
    icon: '🏗️',
    title: 'Construction Project Consultation',
    assessmentName: 'Site Feasibility & Project Consultation',
    categoryName: 'Steelage Commercial Construction Services'
  };
}

module.exports = { getServiceTitleInfo };
